from django.db import models


class Venue(models.Model):
    name = models.CharField(max_length=120)
    city = models.CharField(max_length=80, blank=True, default="")
    tz = models.CharField(max_length=64, default="Australia/Sydney")
    active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class Staff(models.Model):
    venue = models.ForeignKey(Venue, on_delete=models.CASCADE, related_name="staff")
    name = models.CharField(max_length=120)

    def __str__(self):
        return self.name


class Transaction(models.Model):
    """Append-only log. transaction_id is UNIQUE so SQS-style at-least-once
    redelivery / replay is an idempotent no-op (ON CONFLICT DO NOTHING)."""

    SALE, VOID, REFUND = "sale", "void", "refund"
    KIND_CHOICES = [(SALE, "sale"), (VOID, "void"), (REFUND, "refund")]

    transaction_id = models.CharField(max_length=64, unique=True)
    venue = models.ForeignKey(Venue, on_delete=models.CASCADE, related_name="transactions")
    kind = models.CharField(max_length=8, choices=KIND_CHOICES, default=SALE)
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    items = models.JSONField(default=list, blank=True)  # [{item, qty, price}]
    ts = models.DateTimeField()

    class Meta:
        # Composite index on (venue, ts) for drill-down / range scans.
        # (Native day-partitioning is the production upgrade; plain index locally.)
        indexes = [models.Index(fields=["venue", "ts"], name="txn_venue_ts_idx")]


class DailyVenueSales(models.Model):
    """One row per venue per business day — the historical reporting rollup."""

    venue = models.ForeignKey(Venue, on_delete=models.CASCADE, related_name="daily")
    biz_date = models.DateField()
    net_sales = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    txn_count = models.IntegerField(default=0)
    void_count = models.IntegerField(default=0)
    refund_count = models.IntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["venue", "biz_date"], name="uniq_venue_bizdate")]
        indexes = [models.Index(fields=["biz_date"], name="dvs_bizdate_idx")]


class DailyVenueItemSales(models.Model):
    venue = models.ForeignKey(Venue, on_delete=models.CASCADE, related_name="daily_items")
    biz_date = models.DateField()
    item_id = models.CharField(max_length=120)
    qty = models.IntegerField(default=0)
    revenue = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["venue", "biz_date", "item_id"], name="uniq_venue_bizdate_item")]
