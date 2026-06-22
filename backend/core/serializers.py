from rest_framework import serializers
from .models import Transaction


class ItemSerializer(serializers.Serializer):
    item = serializers.CharField(max_length=120)
    qty = serializers.IntegerField(min_value=1, default=1)
    price = serializers.FloatField(required=False, default=0)


class IngestSerializer(serializers.Serializer):
    """The single validation boundary for /ingest. Malformed payloads -> 422,
    never silently dropped."""

    transaction_id = serializers.CharField(max_length=64)
    venue_id = serializers.IntegerField()
    kind = serializers.ChoiceField(choices=[Transaction.SALE, Transaction.VOID, Transaction.REFUND], default=Transaction.SALE)
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, default=0)
    items = ItemSerializer(many=True, required=False, default=list)
    ts = serializers.DateTimeField(required=False)
