# Local Kubernetes Cluster — Ansible Automation

Provisions a 3-node Kubernetes cluster on Multipass VMs alongside a self-hosted Harbor container registry running on the host machine. Designed for local development and testing of the cloud-native notification platform.

## Architecture

```
Host machine
├── Harbor registry (Docker Compose, port 80)
│     └── project: local
└── Multipass VMs
      ├── control-plane  (2 CPU / 4 GB / 20 GB)
      ├── worker1        (2 CPU / 2 GB / 15 GB)
      └── worker2        (2 CPU / 2 GB / 15 GB)
```

The VMs are configured to pull images from Harbor over plain HTTP via containerd's `hosts.toml` per-registry override.

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| [Multipass](https://multipass.run) | ≥ 1.13 | Install via `snap` on Linux or `brew` on macOS |
| Ansible | ≥ 2.15 | `pip install ansible` |
| Docker | any | Linux: `apt install docker.io`; macOS: Docker Desktop |

### Ansible collections

```bash
ansible-galaxy collection install community.general community.docker
```

### SSH key

The playbook connects to VMs using the key at `~/.ssh/ansible` by default.
Ensure the matching public key (`~/.ssh/ansible.pub`) is authorized on the VMs.

Multipass injects `~/.ssh/id_rsa.pub` automatically at launch time. If you use a
different key, pass it to Multipass via a cloud-init file:

```bash
# cloud-init.yml
ssh_authorized_keys:
  - <contents of ~/.ssh/ansible.pub>
```

```bash
multipass launch 24.04 --name control-plane --cloud-init cloud-init.yml ...
```

Alternatively, change `multipass_ssh_key` in `group_vars/all.yml` to point to
whichever key is already authorized on the VMs.

**macOS Multipass system key path** (if you prefer using the built-in key):
```
/var/root/Library/Application Support/multipassd/ssh-keys/id_rsa
```

**Linux Multipass system key path**:
```
/var/snap/multipass/common/data/multipassd/ssh-keys/id_rsa
```

## Running the Playbook

### Full provisioning (all stages)

```bash
ansible-playbook \
  -i infrastructure/ansible/inventory/hosts.ini \
  infrastructure/ansible/site.yml
```

### Run individual stages with tags

| Tag | What it does |
|-----|-------------|
| `registry` | Install Harbor on the host |
| `vms` | Create Multipass VMs, populate inventory |
| `cluster` | Install common deps, containerd, Kubernetes on all nodes |
| `control-plane` | kubeadm init, Flannel, fetch kubeconfig |
| `workers` | Join worker nodes |

```bash
# Example: re-run only the Harbor setup
ansible-playbook \
  -i infrastructure/ansible/inventory/hosts.ini \
  infrastructure/ansible/site.yml \
  --tags registry

# Example: run cluster + control-plane + workers only (VMs already exist)
ansible-playbook \
  -i infrastructure/ansible/inventory/hosts.ini \
  infrastructure/ansible/site.yml \
  --tags cluster,control-plane,workers
```

> **Note:** The `vms` tag must have run at least once before `cluster`,
> `control-plane`, or `workers` — it populates the in-memory inventory.
> When running partial plays, always include `vms` unless you are re-running
> in the same playbook execution context.

## Accessing the Cluster

After the playbook completes, a kubeconfig is written to `~/.kube/config-multipass`.

```bash
export KUBECONFIG=~/.kube/config-multipass
kubectl get nodes
# NAME            STATUS   ROLES           AGE   VERSION
# control-plane   Ready    control-plane   ...   v1.29.x
# worker1         Ready    <none>          ...   v1.29.x
# worker2         Ready    <none>          ...   v1.29.x
```

To merge with your existing kubeconfig:

```bash
KUBECONFIG=~/.kube/config:~/.kube/config-multipass \
  kubectl config view --flatten > ~/.kube/config-merged
mv ~/.kube/config-merged ~/.kube/config
```

## Using Harbor

### Configure the Docker daemon on the host (Linux)

Harbor runs on plain HTTP, so Docker must be told to treat it as an insecure registry.

Add the following to `/etc/docker/daemon.json` (create it if it doesn't exist):

```json
{
  "insecure-registries": ["<HARBOR_HOST_IP>:80"]
}
```

Then restart Docker:

```bash
sudo systemctl restart docker
```

**macOS (Docker Desktop):** Go to **Settings → Docker Engine** and add
`"insecure-registries": ["<HARBOR_HOST_IP>:80"]` to the JSON config, then click
**Apply & Restart**.

Replace `<HARBOR_HOST_IP>` with the IP detected during the playbook run. You can
find it in the play output (`Show detected Harbor host IP`) or by running:

```bash
# Linux
ip addr show mpqemubr0 | grep 'inet ' | awk '{print $2}' | cut -d/ -f1

# macOS
ipconfig getifaddr en0
```

### Push an image to Harbor

```bash
HARBOR_IP=<HARBOR_HOST_IP>

# Tag your image
docker tag myapp:latest ${HARBOR_IP}:80/local/myapp:latest

# Log in (password is harbor_admin_password from group_vars/all.yml)
docker login ${HARBOR_IP}:80 -u admin -p Harbor12345

# Push
docker push ${HARBOR_IP}:80/local/myapp:latest
```

### Reference the image in a Kubernetes manifest

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 1
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
        - name: myapp
          # Replace <HARBOR_HOST_IP> with the actual detected IP
          image: <HARBOR_HOST_IP>:80/local/myapp:latest
          imagePullPolicy: Always
```

The cluster nodes are already configured to pull from `<HARBOR_HOST_IP>:80`
over plain HTTP via containerd's `hosts.toml` override, so no `imagePullSecret`
is needed.

## Configuration

All tuneable variables live in [group_vars/all.yml](group_vars/all.yml):

| Variable | Default | Description |
|----------|---------|-------------|
| `k8s_version` | `1.29` | Kubernetes minor version |
| `pod_network_cidr` | `10.244.0.0/16` | Must match Flannel's default |
| `harbor_version` | `2.10.0` | Harbor release |
| `harbor_admin_password` | `Harbor12345` | Change before exposing to a network |
| `harbor_port` | `80` | Harbor HTTP port |
| `multipass_ssh_key` | `~/.ssh/ansible` | Private key for VM SSH access |
| `multipass_ubuntu_release` | `24.04` | Ubuntu image for VMs |

## Idempotency

The playbook is safe to re-run:

- Harbor is skipped if the `harbor-core` container is already running.
- VMs are skipped if they already appear in `multipass list`.
- `kubeadm init` is skipped if `/etc/kubernetes/admin.conf` already exists.
- Worker join is skipped if `/etc/kubernetes/kubelet.conf` already exists.
- All package installs and file writes use idempotent Ansible modules.

## Teardown

```bash
# Delete and purge VMs
multipass delete control-plane worker1 worker2
multipass purge

# Stop and remove Harbor
cd /opt/harbor
docker compose down -v

# Optional: remove data
sudo rm -rf /opt/harbor /opt/harbor-installer
```
