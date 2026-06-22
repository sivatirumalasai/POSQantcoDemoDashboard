from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from core.models import Venue, DailyVenueSales, DailyVenueItemSales
from core import readmodel, seeddata


class Command(BaseCommand):
    help = "Create 40 venues, seed ~120 days of historical rollups, init the Redis read model. Idempotent."

    def add_arguments(self, parser):
        parser.add_argument("--venues", type=int, default=40)
        parser.add_argument("--days", type=int, default=120)

    @transaction.atomic
    def handle(self, *args, **opts):
        names = seeddata.venue_names(opts["venues"])

        # 1) venues
        venues = []
        for i, name in enumerate(names, start=1):
            v, _ = Venue.objects.update_or_create(
                pk=i, defaults={"name": name, "city": name.split(" ")[0]})
            venues.append(v)
        self.stdout.write(self.style.SUCCESS(f"venues: {len(venues)}"))

        # 2) historical daily rollups (skip today — that's the live/seal boundary)
        today = timezone.localdate()
        days = [today - timedelta(days=k) for k in range(opts["days"], 0, -1)]
        ds_objs, di_objs = [], []
        for v in venues:
            weights = seeddata.item_weights(v.id)
            for d in days:
                net, txns, voids, refunds = seeddata.day_metrics(v.id, d)
                ds_objs.append(DailyVenueSales(
                    venue=v, biz_date=d, net_sales=round(net, 2),
                    txn_count=txns, void_count=voids, refund_count=refunds))
                for it in seeddata.ITEMS:
                    rev = net * weights[it]
                    di_objs.append(DailyVenueItemSales(
                        venue=v, biz_date=d, item_id=it,
                        qty=max(0, round(rev / seeddata.item_price(it))), revenue=round(rev, 2)))

        if not DailyVenueSales.objects.exists():
            DailyVenueSales.objects.bulk_create(ds_objs, batch_size=2000)
            DailyVenueItemSales.objects.bulk_create(di_objs, batch_size=5000)
            self.stdout.write(self.style.SUCCESS(f"rollups: {len(ds_objs)} day rows, {len(di_objs)} item rows"))
        else:
            self.stdout.write("rollups already present — skipping history seed")

        # 3) initialise the Redis read model (so all venues show before any sale)
        r = readmodel.client()
        for v in venues:
            readmodel.init_venue(r, v.id, v.name)
        self.stdout.write(self.style.SUCCESS("redis read model initialised"))
