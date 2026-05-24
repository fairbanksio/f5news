import config from './vite.config';

test('uses the CRA-compatible local port for dev and preview servers', () => {
  expect(config.server).toMatchObject({ port: 3000 });
  expect(config.preview).toMatchObject({ port: 3000 });
});
