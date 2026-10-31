"""Reserve a monthly demo inference attempt without storing document data.

This limits admitted inference attempts, not the AWS account's total bill. Rejected
invocations, initialization, storage, and other account services can still incur
charges. A failed or timed-out attempt is deliberately not refunded.
"""

from datetime import datetime, timedelta, timezone
from functools import lru_cache
import os
import re
from urllib.parse import urlsplit


MAX_MONTHLY_CALLS = 500
AWS_CREDENTIAL_VARIABLES = (
    "AWS_ACCESS_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN", "AWS_SECURITY_TOKEN",
    "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_CREDENTIALS_FULL_URI",
)


class MonthlyLimitExceeded(Exception):
    """The monthly demo allowance has been used."""


class CostGuardUnavailable(Exception):
    """The allowance could not be safely checked; do not run inference."""


def _local_runtime() -> bool:
    hosted = any(os.environ.get(name) for name in (
        "AWS_LAMBDA_FUNCTION_NAME", "AWS_LAMBDA_RUNTIME_API",
        "AWS_LAMBDA_LOG_STREAM_NAME", "AWS_LAMBDA_LOG_GROUP_NAME",
    )) or os.environ.get("AWS_EXECUTION_ENV", "").startswith("AWS_Lambda")
    if not hosted:
        return True
    if os.environ.get("CLASSIFIER_LOCAL_EMULATOR") != "1":
        return False
    # RIE also supplies Lambda function/log identities. Real Lambda supplies
    # nonempty reserved execution-role credentials; RIE inserts empty placeholders.
    # Real credentials or a configured credential endpoint prevent the emulator
    # bypass. This relies on the protected runtime environment, not
    # arbitrary caller-supplied variables. Never bake the local flag into an image.
    if (any(os.environ.get(name) for name in AWS_CREDENTIAL_VARIABLES)
            or any(name in os.environ for name in (
                "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_CREDENTIALS_FULL_URI"))):
        return False
    try:
        endpoint = urlsplit("http://" + os.environ.get("AWS_LAMBDA_RUNTIME_API", ""))
        return (endpoint.hostname in {"localhost", "127.0.0.1", "::1"}
                and endpoint.port is not None and not endpoint.username
                and not endpoint.password and not endpoint.path
                and not endpoint.query and not endpoint.fragment)
    except ValueError:
        return False


@lru_cache(maxsize=1)
def _dynamodb_client():
    # AWS's Python Lambda base includes boto3. Import lazily so ordinary local
    # development does not need credentials or contact an AWS endpoint.
    import boto3
    from botocore.config import Config

    return boto3.client("dynamodb", config=Config(
        connect_timeout=2, read_timeout=2,
        retries={"total_max_attempts": 1, "mode": "standard"},
    ))


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def reserve_inference_attempt() -> None:
    """Admit one attempt, raise a safe error, or skip a verified local runtime.

    The caller must invoke this after cheap validation and before model loading
    or inference. Concurrent workers share one conditional DynamoDB increment.
    """
    if _local_runtime():
        return

    table = os.environ.get("CLASSIFIER_USAGE_TABLE", "")
    function_name = os.environ.get("AWS_LAMBDA_FUNCTION_NAME", "")
    raw_limit = os.environ.get("CLASSIFIER_MONTHLY_MAX_CALLS", "")
    if (not re.fullmatch(r"[A-Za-z0-9_.-]{3,255}", table)
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", function_name)
            or not re.fullmatch(r"[1-9][0-9]{0,2}", raw_limit)
            or int(raw_limit) > MAX_MONTHLY_CALLS
            or os.environ.get("CLASSIFIER_DEPLOYMENT_MODE") != "synthetic_demo"):
        raise CostGuardUnavailable("The demo usage limit is unavailable.")

    now = _utc_now().astimezone(timezone.utc)
    next_month = datetime(now.year + (now.month == 12), now.month % 12 + 1, 1,
                          tzinfo=timezone.utc)
    expires_at = int((next_month + timedelta(days=90)).timestamp())
    try:
        _dynamodb_client().update_item(
            TableName=table,
            Key={"pk": {"S": f"{function_name}#{now:%Y-%m}"}},
            UpdateExpression="SET #expires = if_not_exists(#expires, :expires) ADD #requests :one",
            ConditionExpression="attribute_not_exists(#requests) OR #requests < :limit",
            ExpressionAttributeNames={"#requests": "requests", "#expires": "expiresAt"},
            ExpressionAttributeValues={
                ":one": {"N": "1"}, ":limit": {"N": raw_limit},
                ":expires": {"N": str(expires_at)},
            },
            ReturnValues="NONE",
        )
    except Exception as error:
        response = getattr(error, "response", None)
        details = response.get("Error") if isinstance(response, dict) else None
        code = details.get("Code") if isinstance(details, dict) else None
        if code == "ConditionalCheckFailedException":
            raise MonthlyLimitExceeded("The monthly demo scan limit has been reached.") from None
        raise CostGuardUnavailable("The demo usage limit is unavailable.") from None
