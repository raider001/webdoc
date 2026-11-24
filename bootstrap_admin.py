"""Offline, explicit first-administrator creation. Never exposed over HTTP."""
import argparse
import getpass
from serve import load_config
from webdoc_auth import UserStore, validate_password

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    parser.add_argument('--username', required=True)
    args = parser.parse_args()
    cfg = load_config(args.config)['auth']
    store = UserStore(cfg.users_file, cfg.pbkdf2_iterations)
    if any(u['admin'] or cfg.is_admin_groups(u['groups']) for u in store.list_users()):
        parser.error('an administrator already exists')
    password = getpass.getpass('New administrator password: ')
    ok, message = validate_password(password, cfg.password_min_length)
    if not ok: parser.error(message)
    if password != getpass.getpass('Confirm password: '): parser.error('passwords differ')
    _, error = store.create(args.username, password, admin=True)
    if error: parser.error(error)
    print('Administrator created.')

if __name__ == '__main__':
    main()
