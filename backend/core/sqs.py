"""SQS helpers. Locally the endpoint points at LocalStack (AWS_ENDPOINT_URL);
in production it's unset and boto3 talks to real AWS. Credentials come from the
environment (dummy values for LocalStack)."""
import json

import boto3
from django.conf import settings

_client = None


def client():
    global _client
    if _client is None:
        kwargs = {"region_name": settings.AWS_REGION}
        if settings.AWS_ENDPOINT_URL:
            kwargs["endpoint_url"] = settings.AWS_ENDPOINT_URL
        _client = boto3.client("sqs", **kwargs)
    else: 
        #validate the existing client is still valid (e.g. LocalStack restarted)
        try:
            _client.list_queues(MaxResults=1)
        except Exception:
            kwargs = {"region_name": settings.AWS_REGION}
            if settings.AWS_ENDPOINT_URL:
                kwargs["endpoint_url"] = settings.AWS_ENDPOINT_URL
            _client = boto3.client("sqs", **kwargs) 
    return _client


def ensure_queues():
    """Create the main queue + DLQ with a redrive policy (maxReceiveCount).
    Idempotent — create_queue returns the existing queue if it already exists."""
    c = client()
    dlq_url = c.create_queue(QueueName=settings.SQS_DLQ_NAME)["QueueUrl"]
    dlq_arn = c.get_queue_attributes(
        QueueUrl=dlq_url, AttributeNames=["QueueArn"])["Attributes"]["QueueArn"]
    redrive = json.dumps({
        "deadLetterTargetArn": dlq_arn,
        "maxReceiveCount": str(settings.SQS_MAX_RECEIVE_COUNT),
    })
    main_url = c.create_queue(
        QueueName=settings.SQS_QUEUE_NAME,
        Attributes={"RedrivePolicy": redrive})["QueueUrl"]
    return main_url, dlq_url


def queue_url():
    if settings.SQS_QUEUE_URL:
        return settings.SQS_QUEUE_URL
    return client().get_queue_url(QueueName=settings.SQS_QUEUE_NAME)["QueueUrl"]


def publish(body: dict):
    """Publish one transaction. POS is acked only once this returns (durable)."""
    client().send_message(QueueUrl=queue_url(), MessageBody=json.dumps(body, default=str))
