import { Store } from '../packages/store/index.js';
const store = new Store(process.env.DATABASE_URL!,process.env.DATA_ENCRYPTION_KEY!);
try { await store.migrate(); console.log('Database migrations applied.'); } finally { await store.close(); }
