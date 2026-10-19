const { error } = require('../middleware/response');

test('internal server errors never expose details through the validation errors field', () => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  error(res, 'Database failed', 500, [{ message: 'secret database detail' }]);
  expect(res.json).toHaveBeenCalledWith({
    success: false, message: 'internal_server_error', timestamp: expect.any(String),
  });
});

test('invalid requests retain their field validation errors', () => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const errors = [{ path: 'email', msg: 'invalid_email' }];
  error(res, 'Validation failed', 400, errors);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ errors }));
});
