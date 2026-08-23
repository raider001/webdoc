import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

// auth.js is the only thing faked: it is the server, and there is none here.
// The mirror store, the form, the mode switch and the id generation are all real.
const signIn = vi.fn();
const register = vi.fn();
const auth = {
  enabled: true, loaded: true, user: null, csrf: null, needsBootstrap: false,
  policy: { allowRegistration: true, requireApproval: false, passwordMinLength: 12, groups: [] },
};
vi.mock('/js/auth.js', () => ({
  auth,
  onAuthChange: () => {},
  signIn: (/** @type {*} */ ...a) => signIn(...a),
  register: (/** @type {*} */ ...a) => register(...a),
}));

const { default: SignInWall } = await import('./SignInWall.svelte');
const { startAuthSync } = await import('./stores/auth.svelte.js');

// islands/auth.js calls startAuthSync() before mounting the wall, and the wall
// reads the policy through that mirror rather than through auth.js directly - so
// a test that mounts it without syncing first is testing the store's defaults.
// Every render goes through here, after whatever the test has done to `auth`.
/** @param {Record<string, unknown>} props */
function mountWall(props) {
  startAuthSync();
  return render(SignInWall, { props });
}

beforeEach(() => {
  signIn.mockReset();
  register.mockReset();
  auth.needsBootstrap = false;
  auth.policy.allowRegistration = true;
  auth.policy.requireApproval = false;
});

/** @param {Element} container */
const wallOf = container => container.querySelector('.auth-wall');

describe('SignInWall', () => {
  it('reproduces the wall DOM contract, including the dialog semantics', () => {
    const { container } = mountWall({ onSignedIn: () => {} });
    const wall = wallOf(container);
    expect(wall.getAttribute('role')).toBe('dialog');
    expect(wall.getAttribute('aria-modal')).toBe('true');
    expect(wall.getAttribute('aria-label')).toBe('Sign in');
    expect(container.querySelector('.auth-card .auth-form')).toBeTruthy();
  });

  // THE POINT OF THE COMPONENT. Modal.svelte closes on Escape and on a scrim
  // click; this screen must do neither, because boot() is suspended behind it and
  // a dismissed wall means an empty shell firing library requests the server will
  // refuse one at a time.
  it('cannot be dismissed by Escape', async () => {
    const onSignedIn = vi.fn();
    const { container } = mountWall({ onSignedIn });
    await fireEvent.keyDown(document, { key: 'Escape' });
    await fireEvent.keyDown(wallOf(container), { key: 'Escape' });
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(wallOf(container)).toBeTruthy();
  });

  it('cannot be dismissed by clicking its backdrop', async () => {
    const onSignedIn = vi.fn();
    const { container } = mountWall({ onSignedIn });
    await fireEvent.click(wallOf(container));
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(wallOf(container)).toBeTruthy();
  });

  it('generates UNIQUE input ids, so two of these screens do not collide', () => {
    const a = mountWall({ onSignedIn: () => {} });
    const b = mountWall({ onSignedIn: () => {} });
    const ids = (/** @type {Element} */ root) =>
      [...root.querySelectorAll('input')].map(i => i.id);
    const first = ids(a.container);
    const second = ids(b.container);
    expect(first).toHaveLength(3);
    expect(new Set([...first, ...second]).size).toBe(6);
    // And every label still points at its own box - the thing duplicate ids broke.
    for (const label of a.container.querySelectorAll('label')) {
      expect(first).toContain(label.getAttribute('for'));
    }
  });

  it('signs in, and reports success only once there is a session', async () => {
    signIn.mockResolvedValue({ ok: true });
    const onSignedIn = vi.fn();
    const { container } = mountWall({ onSignedIn });
    const [user, pass] = container.querySelectorAll('input');
    await fireEvent.input(user, { target: { value: '  ada  ' } });
    await fireEvent.input(pass, { target: { value: 'hunter2hunter2' } });
    await fireEvent.submit(container.querySelector('form'));
    expect(signIn).toHaveBeenCalledWith('ada', 'hunter2hunter2');
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it('stays up on a 202, because an unapproved account has no session', async () => {
    auth.policy.requireApproval = true;
    register.mockResolvedValue({ ok: true, pendingApproval: true, message: 'Waiting for approval.' });
    const onSignedIn = vi.fn();
    const { container } = mountWall({ onSignedIn });
    await fireEvent.click(container.querySelector('.auth-link'));   // switch to register
    await fireEvent.submit(container.querySelector('form'));
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(container.querySelector('.auth-status').textContent).toBe('Waiting for approval.');
    expect(container.querySelector('.auth-status').classList.contains('is-ok')).toBe(true);
  });

  it("renders the server's refusal as TEXT - it quotes back what was typed", async () => {
    signIn.mockResolvedValue({ ok: false, error: '<img src=x onerror=alert(1)> is not a user' });
    const { container } = mountWall({ onSignedIn: () => {} });
    await fireEvent.submit(container.querySelector('form'));
    expect(container.querySelector('img')).toBeNull();
    const status = container.querySelector('.auth-status');
    expect(status.textContent).toBe('<img src=x onerror=alert(1)> is not a user');
    expect(status.classList.contains('is-error')).toBe(true);
  });

  it('opens on the register form during bootstrap, and offers no way back', () => {
    auth.needsBootstrap = true;
    const { container } = mountWall({ onSignedIn: () => {} });
    expect(container.querySelector('button[type="submit"]').textContent).toBe('Create account');
    // The first account is not a choice, so "I already have an account" is hidden.
    expect(container.querySelector('.auth-switch').hidden).toBe(true);
    expect(container.querySelector('.auth-hint').textContent)
      .toContain('The first account created becomes the administrator.');
  });

  it('hides the display-name field until it is registering, and quotes the real minimum length', async () => {
    const { container } = mountWall({ onSignedIn: () => {} });
    const nameField = container.querySelectorAll('.modal-field')[2];
    expect(nameField.hidden).toBe(true);
    await fireEvent.click(container.querySelector('.auth-link'));
    expect(nameField.hidden).toBe(false);
    expect(container.querySelector('.auth-hint').textContent).toBe('Passwords must be at least 12 characters.');
  });
});
