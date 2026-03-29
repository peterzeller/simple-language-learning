# Deployment Setup

This project now deploys as a Next.js standalone Node.js server. GitHub Actions builds the standalone bundle, uploads it over SSH, and restarts a systemd service on your server. The Ansible playbook in [`ansible/site.yml`](/Users/peter/work/simple-language-learning/ansible/site.yml) prepares an Ubuntu 24 LTS host with Nginx, Node.js, PostgreSQL, a deploy user and group, and the systemd service that runs the app.

## What the playbook configures

Running the playbook will:

- install `nginx`, `rsync`, PostgreSQL, and Node.js 22
- create the deploy user and group
- optionally install your deploy SSH public key
- create the deployment directory with group-friendly permissions
- enable PostgreSQL and optionally create an app database and role
- install a systemd service for the Next.js app
- install and enable an Nginx reverse proxy for the Node.js app

The GitHub Actions workflow now syncs files with group-writable permissions so future deployments keep working cleanly for the configured deploy user and group.
The Node.js service reads database settings from a dedicated systemd environment file managed by Ansible.

## Files to edit

Copy the example inventory and vars files, then fill in your real host and domain values:

```bash
cp ansible/inventory.ini.example ansible/inventory.ini
mkdir -p ansible/group_vars
cp ansible/group_vars/all.yml.example ansible/group_vars/all.yml
```

Update:

- [`ansible/inventory.ini.example`](/Users/peter/work/simple-language-learning/ansible/inventory.ini.example): SSH host, SSH port, and the bootstrap user Ansible should use
- [`ansible/group_vars/all.yml.example`](/Users/peter/work/simple-language-learning/ansible/group_vars/all.yml.example): deploy user, deploy group, SSH public key, server name, deployment path, Node service settings, and optional PostgreSQL app user/database settings
- [`ansible/README.md`](/Users/peter/work/simple-language-learning/ansible/README.md): a short runbook for provisioning and operating the server

For the first run, `ansible_user` should usually be `root` or another sudo-capable account that can create users and edit `/etc/nginx`.

## Run the playbook

Install Ansible locally if needed, then run:

```bash
ansible-galaxy collection install community.postgresql
ansible-playbook -i ansible/inventory.ini ansible/site.yml
```

The playbook is intentionally strict and will fail if the target host is not Ubuntu 24.

If you want Ansible to create an application database and database user, set `postgres_manage_app_role: true` and `postgres_manage_app_db: true` in [`ansible/group_vars/all.yml.example`](/Users/peter/work/simple-language-learning/ansible/group_vars/all.yml.example), then replace the sample password before running the playbook.

For runtime configuration, the playbook writes `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_DB`, and `POSTGRES_PASSWORD` into `node_service_env_file`. The password is generated and persisted on the server if it does not already exist there, so it does not need to be stored in local `group_vars`. You can also add extra app environment variables through `app_env`.

## GitHub Actions secrets

Create these repository secrets before enabling deployments:

- `DEPLOY_HOST`: Hostname or IP address of the server
- `DEPLOY_PORT`: SSH port, for example `22`
- `DEPLOY_USER`: SSH user created by the playbook, for example `deploy`
- `DEPLOY_PATH`: Absolute target path on the server, for example `/var/www/simple-language-learning`
- `DEPLOY_SERVICE`: Systemd service name, for example `simple-language-learning`
- `DEPLOY_SSH_PRIVATE_KEY`: Private key for the deploy user in OpenSSH format

The matching public key should be included in `deploy_authorized_keys` in [`ansible/group_vars/all.yml.example`](/Users/peter/work/simple-language-learning/ansible/group_vars/all.yml.example).

## Deployment flow

On every push to `main`, GitHub Actions will:

1. Install dependencies.
2. Build the Next.js standalone server bundle.
3. Run the test command.
4. Run ESLint.
5. Upload the standalone bundle to `DEPLOY_PATH` via `rsync` over SSH.
6. Restart the systemd service defined by `DEPLOY_SERVICE`.

The workflow uses `--no-perms` and `--chmod=...` so the deploy group keeps write access on new releases.

## First deployment checklist

1. Confirm Ansible can log in to the server over SSH.
2. Run `ansible-playbook -i ansible/inventory.ini ansible/site.yml`.
3. Confirm the deploy user can log in with the configured SSH key.
4. Add the GitHub Actions secrets, including `DEPLOY_SERVICE`.
5. Push to `main` or trigger the workflow manually from GitHub Actions.
