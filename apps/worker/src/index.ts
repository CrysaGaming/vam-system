import 'dotenv/config';
import { Worker } from 'bullmq';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const worker = new Worker('vatsim.poll', async (job) => {
    console.log('Processing:', job.name, job.data);
}, { connection: { url: REDIS_URL } });

console.log('Worker started on queue vatsim.poll');