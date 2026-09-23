import { cp } from 'node:fs/promises';
await cp('packages/store/migrations','dist/packages/store/migrations',{recursive:true});
