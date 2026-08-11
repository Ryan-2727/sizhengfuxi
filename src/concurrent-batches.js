export async function runConcurrentBatches(batches, worker, options = {}) {
  const concurrency = Math.max(1, Math.min(Number(options.concurrency) || 1, batches.length || 1));
  const results = new Array(batches.length);
  let nextIndex = 0;
  let completedBatches = 0;

  const runWorker = async () => {
    while (nextIndex < batches.length) {
      const index = nextIndex;
      nextIndex += 1;
      const result = await worker(batches[index], index);
      results[index] = result;
      completedBatches += 1;
      options.onBatch?.({ index, result, completedBatches, totalBatches: batches.length });
    }
  };

  await Promise.all(Array.from({ length: concurrency }, runWorker));
  return results;
}
