import { MongoClient, Db } from 'mongodb';

let client: MongoClient | null = null;

export async function getDb(): Promise<Db | null> {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;

  try {
    if (!client) {
      client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
      await client.connect();
    }
    return client.db();
  } catch {
    client = null;
    return null;
  }
}
