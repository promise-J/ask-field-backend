// Test settings. Point TEST_MONGO_URI at a throwaway database: the integration tests wipe it.
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/joinstudy_test';
process.env.JWT_SECRET = 'test-secret';
process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
process.env.PLATFORM_FEE_RATE = '0.2';
process.env.MIN_PAYOUT_AMOUNT = '1000';
process.env.DEFAULT_CURRENCY = 'NGN';
delete process.env.SMTP_HOST;
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.REQUIRE_PARTICIPANT_VERIFICATION = 'false'; // the participant Stage 1 suite turns it on
