const metricsBuffer = [];

export function recordMetric(name) {
  metricsBuffer.push(name);
}

export function flushMetrics() {
  metricsBuffer.length = 0;
}

