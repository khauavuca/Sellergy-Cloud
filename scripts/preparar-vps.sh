#!/usr/bin/env bash
# Prepara e ENDURECE uma VPS Linux (Ubuntu 22.04/24.04 ou Debian 12) recém-criada
# pra rodar o Sellergy Cloud. Pode rodar de novo quantas vezes quiser
# (idempotente): o que já está feito é pulado ou reescrito igual.
#
# Rode como root, LOGADO POR CHAVE SSH (o script desliga login por senha):
#   PORTA_SSH=22 bash scripts/preparar-vps.sh
#
# Variáveis (todas opcionais):
#   USUARIO_DEPLOY   usuário que vai operar a VPS (padrão: deploy)
#   PORTA_SSH        porta do SSH (padrão: 22). Trocar reduz ruído de robôs,
#                    não é segurança de verdade; a chave é que protege.
#   CHAVE_SSH_PUB    chave pública (ssh-ed25519 AAAA... voce@pc) pro usuário de
#                    deploy. Sem ela, copia /root/.ssh/authorized_keys.
#   TAMANHO_SWAP     padrão 2G
#   REINICIO_AUTO    1 = reinicia sozinho às 04:30 quando uma atualização de
#                    segurança pedir (kernel). Padrão 0 (só avisa).
#
# O que faz:
#  1. Pacotes: ufw, fail2ban, unattended-upgrades, age, rclone.
#  2. Usuário de deploy com sudo e acesso por chave.
#  3. SSH: só chave, sem root, sem senha, porta configurável.
#  4. Firewall ufw: só SSH, 80 e 443 (SSH com limite de tentativas).
#  5. fail2ban no sshd (bane IP após 5 erros em 10 min, por 1 h; reincidente 1 semana).
#  6. Atualizações automáticas de SEGURANÇA (unattended-upgrades).
#  7. Swap de 2 GB com swappiness baixo.
#  8. sysctl de rede/kernel (SYN cookies, sem redirect/source route, etc.).
#  9. Docker com rotação de logs e no-new-privileges por padrão.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode como root (sudo bash scripts/preparar-vps.sh)." >&2
  exit 1
fi
if ! command -v apt-get >/dev/null 2>&1; then
  echo "Este script é pra Ubuntu/Debian (apt)." >&2
  exit 1
fi

USUARIO_DEPLOY="${USUARIO_DEPLOY:-deploy}"
PORTA_SSH="${PORTA_SSH:-22}"
TAMANHO_SWAP="${TAMANHO_SWAP:-2G}"
REINICIO_AUTO="${REINICIO_AUTO:-0}"
CHAVE_SSH_PUB="${CHAVE_SSH_PUB:-}"

if ! [[ "$PORTA_SSH" =~ ^[0-9]+$ ]] || [ "$PORTA_SSH" -lt 1 ] || [ "$PORTA_SSH" -gt 65535 ]; then
  echo "PORTA_SSH inválida: $PORTA_SSH" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

# Escreve um arquivo só se o conteúdo mudou. Retorna 0 se mudou, 1 se igual.
escrever_se_mudou() {
  local destino="$1" conteudo
  conteudo="$(cat)"
  if [ -f "$destino" ] && [ "$(cat "$destino")" = "$conteudo" ]; then
    return 1
  fi
  mkdir -p "$(dirname "$destino")"
  printf '%s\n' "$conteudo" > "$destino"
  return 0
}

echo "==> 1. Pacotes"
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl ufw fail2ban python3-systemd \
  unattended-upgrades apt-listchanges age rclone

echo "==> Fuso horário (horário do backup e dos logs)"
timedatectl set-timezone America/Sao_Paulo 2>/dev/null || true

echo "==> 2. Usuário de deploy: $USUARIO_DEPLOY"
if ! id "$USUARIO_DEPLOY" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$USUARIO_DEPLOY"
fi
usermod -aG sudo "$USUARIO_DEPLOY"
# Sem senha (o login é só por chave), então o sudo não pede senha. A proteção
# é a chave SSH: guarde-a com senha (passphrase) no seu PC.
escrever_se_mudou "/etc/sudoers.d/90-$USUARIO_DEPLOY" <<EOF || true
$USUARIO_DEPLOY ALL=(ALL) NOPASSWD:ALL
EOF
chmod 440 "/etc/sudoers.d/90-$USUARIO_DEPLOY"
visudo -cf "/etc/sudoers.d/90-$USUARIO_DEPLOY" >/dev/null

PASTA_SSH="/home/$USUARIO_DEPLOY/.ssh"
install -d -m 700 -o "$USUARIO_DEPLOY" -g "$USUARIO_DEPLOY" "$PASTA_SSH"
touch "$PASTA_SSH/authorized_keys"
if [ -n "$CHAVE_SSH_PUB" ]; then
  grep -qxF "$CHAVE_SSH_PUB" "$PASTA_SSH/authorized_keys" || echo "$CHAVE_SSH_PUB" >> "$PASTA_SSH/authorized_keys"
elif [ -s /root/.ssh/authorized_keys ]; then
  while IFS= read -r linha; do
    [ -z "$linha" ] && continue
    grep -qxF "$linha" "$PASTA_SSH/authorized_keys" || echo "$linha" >> "$PASTA_SSH/authorized_keys"
  done < /root/.ssh/authorized_keys
fi
chown "$USUARIO_DEPLOY:$USUARIO_DEPLOY" "$PASTA_SSH/authorized_keys"
chmod 600 "$PASTA_SSH/authorized_keys"

# Trava de segurança: sem chave cadastrada, NÃO desliga a senha (senão você
# fica trancado pra fora da VPS).
if ! grep -qE '^(ssh-|ecdsa-|sk-)' "$PASTA_SSH/authorized_keys"; then
  echo "ERRO: $USUARIO_DEPLOY não tem chave SSH em $PASTA_SSH/authorized_keys." >&2
  echo "Rode de novo com CHAVE_SSH_PUB='ssh-ed25519 AAAA... voce@pc'." >&2
  exit 1
fi

echo "==> 3. SSH: só chave, sem root, porta $PORTA_SSH"
# Prefixo 00-: no sshd vale o PRIMEIRO valor lido, e arquivos como
# 50-cloud-init.conf costumam religar PasswordAuthentication.
if ! grep -qE '^\s*Include\s+/etc/ssh/sshd_config\.d/\*\.conf' /etc/ssh/sshd_config; then
  sed -i '1i Include /etc/ssh/sshd_config.d/*.conf' /etc/ssh/sshd_config
fi
SSH_MUDOU=0
escrever_se_mudou /etc/ssh/sshd_config.d/00-sellergy.conf <<EOF && SSH_MUDOU=1 || true
# Gerado por scripts/preparar-vps.sh (Sellergy Cloud)
Port $PORTA_SSH
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
PermitEmptyPasswords no
AuthenticationMethods publickey
AllowUsers $USUARIO_DEPLOY
MaxAuthTries 3
MaxSessions 4
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
X11Forwarding no
AllowAgentForwarding no
PermitTunnel no
EOF
mkdir -p /run/sshd
sshd -t

echo "==> 4. Firewall (ufw): SSH $PORTA_SSH, 80, 443"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
# "limit": bloqueia IP que abrir 6+ conexões em 30 s (força bruta).
ufw limit "$PORTA_SSH/tcp" comment 'SSH' >/dev/null
ufw allow 80/tcp comment 'HTTP (Caddy/Lets Encrypt)' >/dev/null
ufw allow 443/tcp comment 'HTTPS' >/dev/null
ufw allow 443/udp comment 'HTTP/3' >/dev/null
ufw --force enable >/dev/null
ufw status verbose

# Só reinicia o SSH depois do firewall liberar a porta nova.
if [ "$SSH_MUDOU" = 1 ]; then
  # Ubuntu 24.04 usa ssh.socket (a porta vem do socket, não do sshd_config).
  if systemctl list-unit-files ssh.socket >/dev/null 2>&1 && systemctl is-enabled ssh.socket >/dev/null 2>&1; then
    systemctl disable --now ssh.socket
    systemctl enable ssh.service
  fi
  systemctl restart ssh 2>/dev/null || systemctl restart sshd
fi

echo "==> 5. fail2ban (sshd)"
escrever_se_mudou /etc/fail2ban/jail.d/sellergy.local <<EOF && systemctl restart fail2ban || true
# Gerado por scripts/preparar-vps.sh (Sellergy Cloud)
[DEFAULT]
banaction = ufw
backend = systemd
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
port = $PORTA_SSH

# Quem for banido 3 vezes num dia fica 1 semana fora.
[recidive]
enabled = true
backend = auto
logpath = /var/log/fail2ban.log
bantime = 1w
findtime = 1d
maxretry = 3
EOF
systemctl enable --now fail2ban

echo "==> 6. Atualizações automáticas de segurança"
escrever_se_mudou /etc/apt/apt.conf.d/20auto-upgrades <<'EOF' || true
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
if [ "$REINICIO_AUTO" = 1 ]; then REINICIAR=true; else REINICIAR=false; fi
# O 50unattended-upgrades padrão do Ubuntu/Debian já instala só a origem de
# SEGURANÇA; aqui só ajustamos limpeza e reinício.
escrever_se_mudou /etc/apt/apt.conf.d/52sellergy-upgrades <<EOF || true
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "$REINICIAR";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
EOF
systemctl enable --now unattended-upgrades

echo "==> 7. Swap ($TAMANHO_SWAP)"
if swapon --show=NAME --noheadings | grep -qx '/swapfile'; then
  echo "    /swapfile já ativo, pulando."
else
  if [ ! -f /swapfile ]; then
    fallocate -l "$TAMANHO_SWAP" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab

echo "==> 8. sysctl (memória, rede e kernel)"
# Obs.: ip_forward fica LIGADO (o Docker precisa dele pra rede dos containers).
escrever_se_mudou /etc/sysctl.d/99-sellergy.conf <<'EOF' || true
# Gerado por scripts/preparar-vps.sh (Sellergy Cloud)
# Memória: só usa swap quando precisa mesmo.
vm.swappiness = 10
vm.vfs_cache_pressure = 50

# Rede: proteção contra SYN flood, spoofing e redirecionamento malicioso.
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.tcp_synack_retries = 2
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.secure_redirects = 0
net.ipv4.conf.default.secure_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv4.conf.all.log_martians = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.icmp_ignore_bogus_error_responses = 1
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv6.conf.default.accept_source_route = 0

# Kernel: esconde endereços do kernel e o dmesg de usuários comuns; sem core
# dump de programas setuid; protege links em pastas compartilhadas.
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
kernel.yama.ptrace_scope = 1
fs.suid_dumpable = 0
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
EOF
sysctl --system >/dev/null

echo "==> 9. Docker"
if command -v docker >/dev/null 2>&1; then
  echo "    Docker já instalado: $(docker --version)"
else
  # Script oficial da Docker (instala o repositório apt deles).
  curl -fsSL https://get.docker.com | sh
fi
# Logs com rotação pra TODO container (inclusive os rodados à mão) e
# no-new-privileges como padrão. live-restore mantém os containers de pé
# quando o próprio Docker é atualizado.
DOCKER_MUDOU=0
if [ -f /etc/docker/daemon.json ] && ! grep -q '"no-new-privileges"' /etc/docker/daemon.json; then
  cp /etc/docker/daemon.json "/etc/docker/daemon.json.bak-$(date +%F-%H%M%S)"
fi
escrever_se_mudou /etc/docker/daemon.json <<'EOF' && DOCKER_MUDOU=1 || true
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "no-new-privileges": true,
  "live-restore": true,
  "userland-proxy": false
}
EOF
systemctl enable --now docker
if [ "$DOCKER_MUDOU" = 1 ]; then systemctl restart docker; fi
# Quem está no grupo docker é, na prática, root. Só o usuário de deploy entra.
usermod -aG docker "$USUARIO_DEPLOY"

echo "==> Pasta de backup"
install -d -m 700 -o "$USUARIO_DEPLOY" -g "$USUARIO_DEPLOY" /var/backups/sellergy

echo
echo "Pronto. Memória e swap:"
free -h
echo
echo "IMPORTANTE: NÃO feche esta sessão ainda. Em OUTRO terminal, teste:"
echo "  ssh -p $PORTA_SSH $USUARIO_DEPLOY@IP_DA_VPS"
echo "Se entrar, está tudo certo. Daqui pra frente use só o usuário $USUARIO_DEPLOY."
if [ "$PORTA_SSH" != 22 ]; then
  echo "Depois de testar a porta nova, feche a 22:  sudo ufw delete limit 22/tcp; sudo ufw delete allow OpenSSH"
fi
echo
echo "Próximo passo (como $USUARIO_DEPLOY): clonar o repositório, criar o .env"
echo "(ver .env.production.example) e rodar:"
echo "  docker compose -f docker-compose.prod.yml up -d --build"
