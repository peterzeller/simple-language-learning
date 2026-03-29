# Ansible Deployment

This playbook provisions an Ubuntu 24 VPS for a Next.js app running behind Nginx with PostgreSQL and a systemd-managed Node.js service.

## 1. Prepare the inventory

Edit the existing inventory and vars files:

```bash
vim ansible/inventory.ini
vim ansible/group_vars/all.yml
```

Edit:

- `ansible/inventory.ini`: your server IP, SSH port, and bootstrap SSH user
- `ansible/group_vars/all.yml`: domain, deploy user SSH key, PostgreSQL options, runtime env vars, and Node service settings

## 2. Install the required Ansible collection

```bash
ansible-galaxy collection install community.postgresql
```

## 3. Run the playbook

```bash
ansible-playbook -i ansible/inventory.ini ansible/site.yml
```

If your bootstrap SSH user needs a sudo password, run:

```bash
ansible-playbook -K -i ansible/inventory.ini ansible/site.yml
```

Ansible will then prompt with `BECOME password:` and you can enter the sudo password for the SSH user from `ansible/inventory.ini`.

If you prefer to store it in inventory instead of typing it interactively, add `ansible_become_password=...` to the host entry in `ansible/inventory.ini`. That is less secure than `-K`, so the interactive prompt is the better default.

## 4. Deploy the app

The repo is configured to deploy a Next.js standalone server build. After the GitHub Actions workflow syncs the files to the server, it restarts the systemd service so Nginx serves the new version.

On the first Ansible run, the service unit is installed and enabled, but it will stay stopped until the first deploy uploads `server.js` to the target directory.
The Nginx template is based on the existing `peeeq.de` server style and expects an existing Certbot certificate under `/etc/letsencrypt/live/{{ nginx_tls_cert_name }}`.
If you need to preserve legacy `location`, `rewrite`, or other server-level directives from the old config, place them in `nginx_extra_https_config_before_app`, `nginx_extra_https_config_after_app`, or `nginx_extra_http_config` in `ansible/group_vars/all.yml` instead of editing the template directly.

To deploy locally the same way as CI, use [scripts/deploy.sh](/Users/peter/work/simple-language-learning/scripts/deploy.sh) with these environment variables set:

```bash
export DEPLOY_HOST=your-server
export DEPLOY_PORT=22
export DEPLOY_USER=deploy
export DEPLOY_PATH=/var/www/simple-language-learning
export DEPLOY_SERVICE=simple-language-learning
export DEPLOY_SSH_KEY="$HOME/.ssh/id_ed25519"

./scripts/deploy.sh
```

The script runs `npm ci`, `npm run build`, `npm test`, `npm run lint`, copies the standalone assets, `rsync`s them to the server, and restarts the systemd service over SSH.

Database credentials are exposed to the app through a systemd `EnvironmentFile` managed by Ansible at `node_service_env_file`, which defaults to `/etc/simple-language-learning.env`. That file includes `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_DB`, and `POSTGRES_PASSWORD`.
The password is not meant to live in local `group_vars`: on the first run, Ansible generates it on the server and writes it into the environment file, and on later runs it reuses the existing server-side value.
If Nginx reports `could not build server_names_hash`, increase `nginx_server_names_hash_bucket_size` in `ansible/group_vars/all.yml`.

## 5. Useful commands

```bash
ssh deploy@your-server
sudo systemctl status simple-language-learning
sudo journalctl -u simple-language-learning -n 100 --no-pager
sudo nginx -t
```
