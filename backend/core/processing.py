"""Shared transaction processing — persist to Postgres (idempotent) + update the
Redis read model. Called inline by /ingest (INGEST_MODE=inline) and by the SQS
consumer (INGEST_MODE=sqs). One code path, so both modes behave identically."""
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction as db_tx
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .models import Venue, Transaction
from . import readmodel


def process_event(data):
    """data: dict with transaction_id, venue_id, kind, amount, items, ts(optional).
    Accepts native types (inline) or JSON-decoded strings (SQS body).
    Returns (created: bool, error: str | None)."""
    try:
        venue = Venue.objects.get(pk=int(data["venue_id"]))
    except (Venue.DoesNotExist, ValueError, KeyError):
        return False, "unknown venue"

    ts = data.get("ts")
    if isinstance(ts, str):
        ts = parse_datetime(ts)
    ts = ts or timezone.now()

    kind = data.get("kind", "sale")
    try:
        amount = Decimal(str(data.get("amount", 0)))
    except (InvalidOperation, TypeError):
        return False, "bad amount"
    items = list(data.get("items") or [])

    created = True
    try:
        with db_tx.atomic():
            Transaction.objects.create(
                transaction_id=data["transaction_id"], venue=venue,
                kind=kind, amount=amount, items=items, ts=ts,
            )
    except IntegrityError:
        created = False  # duplicate / replay — safe no-op (idempotent)

    if created:
        readmodel.apply_event(readmodel.client(), venue.id, venue.name, kind, float(amount), items, ts.hour)

    return created, None
