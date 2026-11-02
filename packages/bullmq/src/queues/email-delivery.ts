interface EmailDeliveryJob {
  getState(): Promise<string>;
  returnvalue: unknown;
}

interface EmailDeliveryQueue {
  getJob(id: string): Promise<EmailDeliveryJob | undefined>;
}

/** A completed queue job is success only when the provider actually accepted it. */
export async function waitForEmailDelivery(queue: EmailDeliveryQueue, jobId: string, timeoutMs = 10_000): Promise<void> {
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    while (!finished) {
      const job = await queue.getJob(jobId);
      if (!job) throw new Error('Required email job is unavailable.');
      const state = await job.getState();
      if (state === 'completed') {
        // The worker can finish between getJob() and getState(). Refresh the
        // completed hash instead of inspecting the earlier pending snapshot.
        const result = (await queue.getJob(jobId))?.returnvalue;
        if (result && typeof result === 'object' && 'sent' in result && result.sent === true) return;
        throw new Error('Required email was not accepted by its provider.');
      }
      if (state === 'failed') throw new Error('Required email delivery failed.');
      if (!finished) await new Promise((resolve) => setTimeout(resolve, 150));
    }
  };
  try {
    await Promise.race([
      poll(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Required email delivery timed out.')), timeoutMs);
      }),
    ]);
  } finally {
    finished = true;
    clearTimeout(timer);
  }
}
