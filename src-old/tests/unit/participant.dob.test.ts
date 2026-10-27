import { ageOn, parseDob } from '../../modules/user/controllers/participant.controller';

describe('parseDob', () => {
  it('reads month names and numbers', () => {
    expect(parseDob('5', 'Mar', '1990')?.toISOString()).toBe('1990-03-05T00:00:00.000Z');
    expect(parseDob(5, 3, 1990)?.toISOString()).toBe('1990-03-05T00:00:00.000Z');
    expect(parseDob('5', 'September', '1990')?.getUTCMonth()).toBe(8);
  });
  it('rejects impossible dates', () => {
    expect(parseDob('31', 'Feb', '1990')).toBeNull();
    expect(parseDob('', '', '')).toBeNull();
  });
  it('computes age around birthdays', () => {
    const dob = new Date(Date.UTC(2000, 5, 15));
    expect(ageOn(dob, new Date(Date.UTC(2026, 5, 14)))).toBe(25);
    expect(ageOn(dob, new Date(Date.UTC(2026, 5, 15)))).toBe(26);
  });
});
