'use strict';

const { isNil, isPlainObject, rejectUnknownFields, requireJsonContentType } = require('../../src/middlewares/validationHelpers');

const req = (contentType) => ({ get: (name) => (name.toLowerCase() === 'content-type' ? contentType : undefined) });

describe('validationHelpers (T29)', () => {
  test('isNil', () => {
    expect([null, undefined].every(isNil)).toBe(true);
    expect([0, '', false, {}].some(isNil)).toBe(false);
  });

  test('isPlainObject recusa null, array e primitivos', () => {
    expect(isPlainObject({})).toBe(true);
    expect([null, undefined, [], 'x', 1, true].some(isPlainObject)).toBe(false);
  });

  test('rejectUnknownFields aceita lista ou objeto e informa o campo', () => {
    expect(() => rejectUnknownFields({ a: 1 }, ['a', 'b'])).not.toThrow();
    expect(() => rejectUnknownFields({ a: 1 }, { a: {} })).not.toThrow();
    expect(() => rejectUnknownFields({}, [])).not.toThrow();
    expect(() => rejectUnknownFields({ a: 1, z: 2 }, ['a'])).toThrow(
      expect.objectContaining({ code: 'UNKNOWN_FIELD', status: 400, field: 'z' })
    );
    expect(() => rejectUnknownFields({ x: 1 }, [])).toThrow(expect.objectContaining({ code: 'UNKNOWN_FIELD' }));
  });

  test.each(['application/json', 'Application/JSON; charset=utf-8', 'application/json;charset=UTF-8'])(
    'requireJsonContentType aceita %s', (type) => {
      expect(() => requireJsonContentType(req(type))).not.toThrow();
    }
  );

  test.each([undefined, '', 'text/plain', 'application/x-www-form-urlencoded', 'application/jsonp', 'multipart/form-data'])(
    'requireJsonContentType recusa %p com 415', (type) => {
      expect(() => requireJsonContentType(req(type))).toThrow(expect.objectContaining({ status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' }));
    }
  );
});
