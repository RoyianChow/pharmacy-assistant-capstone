from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
from threading import Lock
from types import SimpleNamespace

import pytest

import cost_guard as guard


ENVIRONMENT = (
    "AWS_LAMBDA_FUNCTION_NAME", "AWS_LAMBDA_RUNTIME_API", "AWS_EXECUTION_ENV",
    "AWS_LAMBDA_LOG_STREAM_NAME", "AWS_LAMBDA_LOG_GROUP_NAME",
    "CLASSIFIER_LOCAL_EMULATOR", "CLASSIFIER_USAGE_TABLE",
    "CLASSIFIER_MONTHLY_MAX_CALLS", "CLASSIFIER_DEPLOYMENT_MODE",
) + guard.AWS_CREDENTIAL_VARIABLES


class DynamoError(Exception):
    def __init__(self, code):
        super().__init__("private AWS details must not escape")
        self.response = {"Error": {"Code": code, "Message": str(self)}}


class AtomicCounter:
    """Emulate only Dynamo's atomic condition/update; no cloud calls are made."""

    def __init__(self):
        self.items = {}
        self.calls = []
        self.lock = Lock()

    def update_item(self, **request):
        with self.lock:
            self.calls.append(request)
            assert request["ConditionExpression"] == "attribute_not_exists(#requests) OR #requests < :limit"
            assert request["UpdateExpression"] == "SET #expires = if_not_exists(#expires, :expires) ADD #requests :one"
            assert request["ExpressionAttributeNames"] == {"#requests": "requests", "#expires": "expiresAt"}
            values = request["ExpressionAttributeValues"]
            key = request["Key"]["pk"]["S"]
            item = self.items.setdefault(key, {"requests": 0, "expiresAt": int(values[":expires"]["N"])})
            if item["requests"] >= int(values[":limit"]["N"]):
                raise DynamoError("ConditionalCheckFailedException")
            item["requests"] += int(values[":one"]["N"])
        return {}


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch):
    for name in ENVIRONMENT:
        monkeypatch.delenv(name, raising=False)
    original_factory = guard._dynamodb_client
    original_factory.cache_clear()
    yield
    original_factory.cache_clear()


@pytest.fixture
def hosted(monkeypatch):
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "pharmacy-prescription-classifier")
    monkeypatch.setenv("AWS_LAMBDA_LOG_STREAM_NAME", "2026/10/31/[$LATEST]example")
    monkeypatch.setenv("CLASSIFIER_USAGE_TABLE", "demo-usage-counter")
    monkeypatch.setenv("CLASSIFIER_MONTHLY_MAX_CALLS", "500")
    monkeypatch.setenv("CLASSIFIER_DEPLOYMENT_MODE", "synthetic_demo")
    monkeypatch.setattr(guard, "_utc_now", lambda: datetime(2026, 10, 31, 16, tzinfo=timezone.utc))
    counter = AtomicCounter()
    monkeypatch.setattr(guard, "_dynamodb_client", lambda: counter)
    return counter


def test_plain_local_execution_never_initializes_aws_client(monkeypatch):
    monkeypatch.setattr(guard, "_dynamodb_client", lambda: pytest.fail("Local execution contacted AWS"))
    assert guard.reserve_inference_attempt() is None


@pytest.mark.parametrize("endpoint", ["127.0.0.1:9001", "localhost:9001", "[::1]:9001"])
def test_explicit_loopback_emulator_can_run_without_cloud_config(monkeypatch, endpoint):
    monkeypatch.setenv("CLASSIFIER_LOCAL_EMULATOR", "1")
    monkeypatch.setenv("AWS_LAMBDA_RUNTIME_API", endpoint)
    monkeypatch.setenv("AWS_EXECUTION_ENV", "AWS_Lambda_python3.12")
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "test_function")
    monkeypatch.setenv("AWS_LAMBDA_LOG_STREAM_NAME", "$LATEST")
    monkeypatch.setenv("AWS_LAMBDA_LOG_GROUP_NAME", "/aws/lambda/Functions")
    for name in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
        monkeypatch.setenv(name, "")  # Actual RIE invocation process placeholders.
    monkeypatch.setattr(guard, "_dynamodb_client", lambda: pytest.fail("RIE contacted AWS"))
    assert guard.reserve_inference_attempt() is None


@pytest.mark.parametrize("endpoint", ["127.0.0.1", "127.0.0.1:bad", "example.com:9001",
    "127.0.0.1.example.com:9001", "user@localhost:9001", "localhost:9001/path"])
def test_emulator_flag_requires_exact_loopback_runtime(monkeypatch, endpoint):
    monkeypatch.setenv("CLASSIFIER_LOCAL_EMULATOR", "1")
    monkeypatch.setenv("AWS_LAMBDA_RUNTIME_API", endpoint)
    with pytest.raises(guard.CostGuardUnavailable):
        guard.reserve_inference_attempt()


@pytest.mark.parametrize("credential", guard.AWS_CREDENTIAL_VARIABLES)
def test_nonempty_credentials_disable_emulator_bypass(monkeypatch, credential):
    monkeypatch.setenv("CLASSIFIER_LOCAL_EMULATOR", "1")
    monkeypatch.setenv("AWS_LAMBDA_RUNTIME_API", "127.0.0.1:9001")
    monkeypatch.setenv(credential, "fake-test-value")
    with pytest.raises(guard.CostGuardUnavailable):
        guard.reserve_inference_attempt()


@pytest.mark.parametrize("credential", ["AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_CREDENTIALS_FULL_URI"])
def test_even_empty_container_credential_endpoint_disables_emulator_bypass(monkeypatch, credential):
    monkeypatch.setenv("CLASSIFIER_LOCAL_EMULATOR", "1")
    monkeypatch.setenv("AWS_LAMBDA_RUNTIME_API", "127.0.0.1:9001")
    monkeypatch.setenv(credential, "")
    with pytest.raises(guard.CostGuardUnavailable):
        guard.reserve_inference_attempt()


def test_deployed_lambda_with_emulator_flag_still_increments_counter(hosted, monkeypatch):
    monkeypatch.setenv("CLASSIFIER_LOCAL_EMULATOR", "1")
    monkeypatch.setenv("AWS_LAMBDA_RUNTIME_API", "127.0.0.1:9001")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "fake-test-value")
    guard.reserve_inference_attempt()
    assert len(hosted.calls) == 1
    assert list(hosted.items.values())[0]["requests"] == 1


@pytest.mark.parametrize("name,value", [
    ("CLASSIFIER_USAGE_TABLE", ""), ("CLASSIFIER_USAGE_TABLE", "bad/table"),
    ("AWS_LAMBDA_FUNCTION_NAME", ""), ("CLASSIFIER_MONTHLY_MAX_CALLS", ""),
    ("CLASSIFIER_MONTHLY_MAX_CALLS", "501"), ("CLASSIFIER_MONTHLY_MAX_CALLS", "0"),
    ("CLASSIFIER_MONTHLY_MAX_CALLS", "-1"), ("CLASSIFIER_MONTHLY_MAX_CALLS", "5.5"),
    ("CLASSIFIER_MONTHLY_MAX_CALLS", " 500"), ("CLASSIFIER_MONTHLY_MAX_CALLS", "0500"),
    ("CLASSIFIER_DEPLOYMENT_MODE", ""), ("CLASSIFIER_DEPLOYMENT_MODE", "production"),
])
def test_hosted_configuration_fails_closed_before_client_use(hosted, monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(guard.CostGuardUnavailable, match="^The demo usage limit is unavailable.$"):
        guard.reserve_inference_attempt()
    assert hosted.calls == []


def test_counter_writes_only_function_month_count_and_expiry(hosted):
    guard.reserve_inference_attempt()
    request = hosted.calls[0]
    assert request["TableName"] == "demo-usage-counter"
    assert request["Key"] == {"pk": {"S": "pharmacy-prescription-classifier#2026-10"}}
    assert request["ReturnValues"] == "NONE"
    assert request["ExpressionAttributeValues"] == {
        ":one": {"N": "1"}, ":limit": {"N": "500"},
        ":expires": {"N": str(int((datetime(2026, 11, 1, tzinfo=timezone.utc) + timedelta(days=90)).timestamp()))},
    }
    assert set(request) == {"TableName", "Key", "UpdateExpression", "ConditionExpression",
                            "ExpressionAttributeNames", "ExpressionAttributeValues", "ReturnValues"}
    assert list(hosted.items.values())[0]["requests"] == 1


def test_concurrent_requests_admit_exactly_500_and_never_refund_failures(hosted):
    def attempt(_index):
        try:
            guard.reserve_inference_attempt()
            return True
        except guard.MonthlyLimitExceeded:
            return False

    with ThreadPoolExecutor(max_workers=12) as executor:
        admitted = list(executor.map(attempt, range(600)))
    assert sum(admitted) == 500
    assert len(hosted.calls) == 600
    assert list(hosted.items.values())[0]["requests"] == 500
    with pytest.raises(guard.MonthlyLimitExceeded, match="^The monthly demo scan limit has been reached.$"):
        guard.reserve_inference_attempt()
    assert list(hosted.items.values())[0]["requests"] == 500


def test_month_rollover_creates_new_utc_key_without_resetting_previous_month(hosted, monkeypatch):
    monkeypatch.setenv("CLASSIFIER_MONTHLY_MAX_CALLS", "1")
    monkeypatch.setattr(guard, "_utc_now", lambda: datetime(2026, 12, 31, 23, 59, tzinfo=timezone.utc))
    guard.reserve_inference_attempt()
    with pytest.raises(guard.MonthlyLimitExceeded):
        guard.reserve_inference_attempt()
    monkeypatch.setattr(guard, "_utc_now", lambda: datetime(2026, 12, 31, 23, 30,
                                                           tzinfo=timezone(timedelta(hours=-4))))
    guard.reserve_inference_attempt()
    assert hosted.items["pharmacy-prescription-classifier#2026-12"]["requests"] == 1
    january = hosted.items["pharmacy-prescription-classifier#2027-01"]
    assert january["requests"] == 1
    assert january["expiresAt"] == int((datetime(2027, 2, 1, tzinfo=timezone.utc) + timedelta(days=90)).timestamp())


def test_separate_functions_have_separate_allowances(hosted, monkeypatch):
    monkeypatch.setenv("CLASSIFIER_MONTHLY_MAX_CALLS", "1")
    guard.reserve_inference_attempt()
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "second-demo-function")
    guard.reserve_inference_attempt()
    assert len(hosted.items) == 2
    assert all(item["requests"] == 1 for item in hosted.items.values())


@pytest.mark.parametrize("error", [DynamoError("AccessDeniedException"),
    DynamoError("ResourceNotFoundException"), TimeoutError("private endpoint"),
    ImportError("private installation path")])
def test_unavailable_counter_is_sanitized_and_never_retried(hosted, monkeypatch, error):
    calls = []

    def fail(**request):
        calls.append(request)
        raise error

    monkeypatch.setattr(guard, "_dynamodb_client", lambda: SimpleNamespace(update_item=fail))
    with pytest.raises(guard.CostGuardUnavailable) as caught:
        guard.reserve_inference_attempt()
    assert str(caught.value) == "The demo usage limit is unavailable."
    assert caught.value.__suppress_context__ is True
    assert len(calls) == 1


def test_sdk_client_has_no_retries_and_is_reused(monkeypatch):
    calls = []
    client = object()

    def create_client(service, **kwargs):
        calls.append((service, kwargs))
        return client

    monkeypatch.setitem(sys.modules, "boto3", SimpleNamespace(client=create_client))
    monkeypatch.setitem(sys.modules, "botocore.config", SimpleNamespace(Config=lambda **kwargs: kwargs))
    assert guard._dynamodb_client() is client
    assert guard._dynamodb_client() is client
    assert calls == [("dynamodb", {"config": {"connect_timeout": 2, "read_timeout": 2,
        "retries": {"total_max_attempts": 1, "mode": "standard"}}})]


def test_deployment_wires_counter_with_only_own_table_permission():
    template = json.loads((Path(__file__).resolve().parents[3] / "infra/aws/classifier-stack.json").read_text())
    resources = template["Resources"]
    table = resources["UsageTable"]["Properties"]
    assert table["BillingMode"] == "PAY_PER_REQUEST"
    assert table["KeySchema"] == [{"AttributeName": "pk", "KeyType": "HASH"}]
    assert table["TimeToLiveSpecification"] == {"AttributeName": "expiresAt", "Enabled": True}
    function = resources["Classifier"]["Properties"]
    assert function["Environment"]["Variables"] == {
        "CLASSIFIER_DEPLOYMENT_MODE": "synthetic_demo",
        "CLASSIFIER_USAGE_TABLE": {"Ref": "UsageTable"}, "CLASSIFIER_MONTHLY_MAX_CALLS": "500",
    }
    assert (function["MemorySize"], function["Timeout"], function["ReservedConcurrentExecutions"]) == (1024, 30, 2)
    policies = resources["ExecutionRole"]["Properties"]["Policies"]
    statements = [statement for policy in policies for statement in policy["PolicyDocument"]["Statement"]]
    dynamo = [statement for statement in statements if "dynamodb" in json.dumps(statement)]
    assert dynamo == [{"Effect": "Allow", "Action": "dynamodb:UpdateItem",
                       "Resource": {"Fn::GetAtt": ["UsageTable", "Arn"]}}]
