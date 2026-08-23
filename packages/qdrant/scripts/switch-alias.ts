import { getQdrantClient } from '../src/client';

const client = getQdrantClient();
if (!client) throw new Error('QDRANT_URL is required.');

const previous = process.env.QDRANT_PREVIOUS_COLLECTION?.trim();
const confirmedTarget = process.env.QDRANT_SWITCH_TO?.trim();
if (!previous?.startsWith(`${client.alias}_`)) {
  throw new Error(`QDRANT_PREVIOUS_COLLECTION must name a versioned collection under ${client.alias}_.`);
}
if (confirmedTarget !== client.collection) {
  throw new Error(`Set QDRANT_SWITCH_TO=${client.collection} to confirm the exact configured target.`);
}
if (previous === client.collection) throw new Error('The previous and target collections must differ.');

await client.switchAlias(previous);
console.log(JSON.stringify({ alias: client.alias, from: previous, to: client.collection }));
