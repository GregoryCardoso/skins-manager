const request = require('supertest');
const app = require('../../src/app');

test(':memory: -> 409 BACKUP_UNAVAILABLE no export e no import', async () => {
  const exp = await request(app).get('/api/backup/export');
  expect(exp.status).toBe(409);
  expect(exp.body.error.code).toBe('BACKUP_UNAVAILABLE');
  const imp = await request(app).post('/api/backup/import').set('Content-Type', 'application/octet-stream').send(Buffer.from('x'));
  expect(imp.status).toBe(409);
  expect(imp.body.error.code).toBe('BACKUP_UNAVAILABLE');
});
