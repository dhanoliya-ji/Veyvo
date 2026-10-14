import { describe, expect, it } from '@jest/globals';
import { ApiError, errorMessage, fieldErrors } from '@/lib/api';

describe('api error helpers', () => {
  it('turns network errors into friendly text', () => {
    expect(errorMessage(new ApiError(0, 'network_error', 'x'))).toMatch(/couldn't reach Veyvo/i);
  });

  it('hides server errors behind a calm message', () => {
    expect(errorMessage(new ApiError(500, 'internal_error', 'Traceback...'))).not.toMatch(/Traceback/);
  });

  it('passes through user-facing messages', () => {
    expect(errorMessage(new ApiError(409, 'room_full', 'This hangout is full right now.'))).toBe('This hangout is full right now.');
  });

  it('maps validation errors to fields', () => {
    const err = new ApiError(422, 'validation_error', 'bad', { fields: [{ field: 'email', message: 'Value error, Enter a valid email.' }] });
    expect(fieldErrors(err)).toEqual({ email: 'Enter a valid email.' });
  });
});
