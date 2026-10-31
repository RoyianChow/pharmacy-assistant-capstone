FROM public.ecr.aws/lambda/python:3.12
COPY requirements-inference.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements-inference.txt
COPY preprocess.py lambda_function.py cost_guard.py validate_artifact.py ${LAMBDA_TASK_ROOT}/
# Only deliberately selected artifacts are included; deployment mode must match.
COPY artifacts/ ${LAMBDA_TASK_ROOT}/model/
RUN chmod -R a-w ${LAMBDA_TASK_ROOT}/model
ENV MODEL_DIR=/var/task/model PYTHONDONTWRITEBYTECODE=1
CMD ["lambda_function.handler"]
