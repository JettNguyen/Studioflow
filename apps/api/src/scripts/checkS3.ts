import { env } from '../config.js';
import { runS3HealthCheck } from '../storage/s3Storage.js';

async function main() {
  try {
    const result = await runS3HealthCheck();

    if (!result.ok) {
      console.error('S3 check failed:', result.message);
      process.exit(1);
    }

    console.log('S3 check passed');
    console.log(`Bucket: ${result.bucket}`);
    console.log(`Region: ${result.region}`);
    console.log(`Endpoint: ${result.endpoint}`);
  } catch (error) {
    console.error('S3 check failed with error');
    console.error(error);

    if (
      typeof error === 'object' &&
      error !== null &&
      '$metadata' in error &&
      typeof (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 'number'
    ) {
      const statusCode = (error as { $metadata: { httpStatusCode: number } }).$metadata.httpStatusCode;

      if (statusCode === 403) {
        console.error('Likely causes for 403:');
        console.error(`- IAM user/key does not have access to bucket ${env.s3Bucket}`);
        console.error(`- Bucket is in a different region than configured (${env.s3Region})`);
        console.error(`- S3 endpoint is incorrect (${env.s3Endpoint})`);
      }

      if (statusCode === 404) {
        console.error(`Bucket ${env.s3Bucket} was not found for this account/region.`);
      }
    }

    process.exit(1);
  }
}

void main();
