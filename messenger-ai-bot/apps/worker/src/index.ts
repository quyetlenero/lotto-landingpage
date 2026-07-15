import { Worker } from "bullmq";
import { INBOUND_MESSAGE_QUEUE, getQueueConnection, type InboundMessageJob } from "@messenger-bot/queue";
import { processInboundMessageJob } from "./processMessage.js";

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 10);

const worker = new Worker<InboundMessageJob>(
  INBOUND_MESSAGE_QUEUE,
  async (job) => {
    await processInboundMessageJob(job.data);
  },
  { connection: getQueueConnection(), concurrency: CONCURRENCY },
);

worker.on("completed", (job) => {
  console.log(`[worker] processed ${job.id}`);
});

worker.on("failed", (job, err) => {
  console.error(`[worker] job ${job?.id} failed`, err);
});

console.log(`[worker] listening on queue "${INBOUND_MESSAGE_QUEUE}" with concurrency ${CONCURRENCY}`);
