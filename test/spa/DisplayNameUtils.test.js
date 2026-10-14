import { memberDisplayName, youthDisplayName, youthFirstName } from '../../spa/utils/DisplayNameUtils.js';

describe('the name shown for a youth or a leader', () => {
  test('a youth\'s nickname replaces the first name when it is filled in', () => {
    expect(youthFirstName({ first_name: 'Maximilien', nickname: 'Max' })).toBe('Max');
    expect(youthDisplayName({ first_name: 'Maximilien', last_name: 'Roy', nickname: ' Max ' })).toBe('Max Roy');
  });

  test('without a nickname, or with a blank one, the first name is shown', () => {
    expect(youthDisplayName({ first_name: 'Vincent', last_name: 'Roy', nickname: null })).toBe('Vincent Roy');
    expect(youthDisplayName({ first_name: 'Vincent', last_name: 'Roy', nickname: '   ' })).toBe('Vincent Roy');
  });

  test('a leader\'s nickname (totem name) replaces the full name', () => {
    expect(memberDisplayName({ full_name: 'Christian Sabourin', nickname: 'Akela' })).toBe('Akela');
    expect(memberDisplayName({ full_name: 'Christian Sabourin', nickname: '' })).toBe('Christian Sabourin');
  });

  test('a missing record gives an empty name rather than "undefined"', () => {
    expect(youthDisplayName(null)).toBe('');
    expect(memberDisplayName(undefined)).toBe('');
  });
});
