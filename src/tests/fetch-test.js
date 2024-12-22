import { ContentFetcher } from '../utils/content-fetcher.js';

async function testFetch() {
  const fetcher = new ContentFetcher({
    maxRetries: 3,
    retryDelay: 1000,
    timeout: 5000,
  });

  try {
    const result = await fetcher.fetchContent(
      'https://modelcontextprotocol.io/docs/concepts/architecture'
    );
    console.log('Content:', result.content);
    console.log('Metadata:', result.metadata);
  } catch (error) {
    console.error('Error:', error);
  }
}

testFetch();
