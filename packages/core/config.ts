import { resolve } from 'node:path';
export type Config={databaseUrl:string;dataKey:string;mcpToken:string;ownerToken:string;ownerId:string;port:number;profileDir:string;liveEnabled:boolean;retainObservations:boolean};
export function loadConfig(env:NodeJS.ProcessEnv=process.env):Config {
  for(const key of ['DATABASE_URL','DATA_ENCRYPTION_KEY','MCP_TOKEN','OWNER_TOKEN']) if(!env[key]) throw new Error(`Missing ${key}; run pnpm run local:init`);
  if(env.MCP_TOKEN===env.OWNER_TOKEN) throw new Error('Owner and MCP secrets must be different');
  if(env.MCP_TOKEN!.length<32||env.OWNER_TOKEN!.length<32) throw new Error('Authentication secrets must contain at least 32 random characters');
  const port=Number(env.PORT??3433);if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('Invalid PORT');
  return {databaseUrl:env.DATABASE_URL!,dataKey:env.DATA_ENCRYPTION_KEY!,mcpToken:env.MCP_TOKEN!,ownerToken:env.OWNER_TOKEN!,ownerId:env.OWNER_ID??'local-owner',port,profileDir:resolve(env.AMAZON_PROFILE_DIR??'.local/amazon-profile'),liveEnabled:env.AMAZON_LIVE_ENABLED==='true',retainObservations:env.RETAIN_OBSERVATIONS==='true'};
}
