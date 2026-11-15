---
title: "Building My Own Homelab on an Ubuntu VPS – A Small Corner to Self-Host and Explore Technology"
description: "A personal Homelab on an Ubuntu VPS for self-hosting services and learning about Linux, networking and infrastructure: Ansible for infrastructure as code, Docker Compose, Tailscale for private networking, UFW, Fail2ban and CrowdSec for security, Hermes Agent, Bield for server management and monitoring, LogDeck for Docker logs, Grafito for system logs, Restic for backup, all kept in Git."
slug: "tu-xay-dung-homelab-tren-ubuntu-vps-goc-nho-de-self-host-va-kham-pha-cong-nghe"
locale: "en"
translationKey: "tu-xay-dung-homelab-tren-ubuntu-vps-goc-nho-de-self-host-va-kham-pha-cong-nghe"
pubDate: 2026-11-07T12:43:57+07:00
category: "DevOps & Infrastructure"
tags: ["homelab", "SelfHosting"]
featured: false
draft: false
series: null
coverImage: "./cover.png"
readingTime: 6
---

Lately I've been spending time building a Homelab on a personal VPS.

Not to run a production system or stand up some overly complex infrastructure. Simply because I want a space of my own to self-host services, try out new technology, and learn about Linux, networking, security and infrastructure.

Instead of having to hunt for an external service every time I need a tool, I want to manage part of my own infrastructure.

It's also a fairly interesting way to learn more about DevOps and System Administration.

I've kept all the configuration and the setup process in a repository:

**GitHub:** [https://github.com/hungpt99-dev/vps-harden](https://github.com/hungpt99-dev/vps-harden)

## 1. Homelab Overview

My environment runs Ubuntu Server on a VPS.

Some of the main components:

| Component | Technology |
|---|---|
| Operating System | Ubuntu Server |
| Infrastructure Automation | Ansible |
| Container Runtime | Docker |
| Container Management | Docker Compose |
| Server Management & Monitoring | [Bield](https://github.com/manasseh-fikadu/bield) |
| Network Gateway | [Gately](https://github.com/wangwanjie/gately) |
| Private Networking | Tailscale |
| Firewall | UFW |
| Intrusion Prevention | Gately |
| AI Agent | Hermes Agent |
| Docker Logging | [LogDeck](https://github.com/AmoabaKelvin/logdeck) |
| System Logging | [Grafito](https://github.com/ralsina/grafito) |
| Backup | Restic |
| Source Control | Git |

Not all of it is needed from the start. I picked each component based on need and on how well it can be expanded later.

## 2. Infrastructure Management with Ansible

One thing I wanted to do from the beginning was manage server configuration with Infrastructure as Code.

I chose Ansible to manage:

- Linux system configuration.
- SSH hardening.
- Firewall rules.
- Security services.
- Docker installation.
- Monitoring setup.
- Backup configuration.

Instead of memorizing and re-running a pile of commands every time I set up a server, I can define the configuration as Ansible Playbooks and Roles.

What I like about this approach is that the configuration lives in Git, changes are easy to track, and it's reusable.

## 3. Containerization with Docker

Docker is one of the most important parts of the Homelab.

I use Docker Compose to manage services instead of installing everything directly on Ubuntu.

Some benefits:

- Isolation between application environments.
- Easy service lifecycle management.
- Easy to upgrade or replace.
- Persistent volume management.
- Easy data backup and restore.

Each group of services is organized into its own Compose project for easier management.

## 4. Private Networking with Tailscale

One problem with self-hosting services on a VPS is how to reach them from outside without opening too many public ports.

I chose Tailscale for this.

Tailscale builds a private network on top of WireGuard, letting authenticated devices connect to each other.

Some administrative services can be reachable only through the private network:

- SSH.
- Bield.
- Gately management interface.
- LogDeck.
- Grafito.
- Hermes Agent.
- Other internal services.

Thanks to that, I don't need to expose the entire management interface to the Internet.

## 5. Security – It's Not Just About Opening the Firewall

This is the part I wanted to focus on when building the Homelab.

Even though it's just a personal VPS, the server can still become a target for automated scans, SSH brute-force attempts or exploitation of common vulnerabilities on the Internet.

Some of the tools and solutions I use:

**UFW**

Manages the firewall and controls connections to the server. By default it restricts inbound traffic and only opens the ports that are genuinely needed.

**Gately**

Uses the network protection and application gateway features, helping detect and handle suspicious behaviour.

**SSH Hardening**

- Use SSH key authentication.
- Disable root login.
- Restrict password authentication after verifying that SSH keys work.
- Grant only the permissions each user needs.

Beyond that, I also pay attention to limiting access to the management interfaces and preferring the private network where possible.

One thing to keep in mind is that Docker has its own network and firewall management. So turning on UFW doesn't mean every container is properly protected.

## 6. Hermes Agent

In the Homelab I also installed Hermes Agent to experiment with interacting with the server through AI.

Some of the tasks I wanted to try:

- Check VPS status.
- Read and analyze system logs.
- Check Docker containers.
- Assist with troubleshooting.
- Run defined automations.
- Help check security configuration.

I see this as a supporting tool for operations, not something that fully replaces traditional system administration tools.

## 7. Monitoring and Logging

A system running stably doesn't mean I know it's actually healthy.

So I picked a few separate monitoring and logging tools to watch server health and to help with troubleshooting when something goes wrong.

**Bield – Server Management & Monitoring**

Bield provides a central management interface for the machines in the Tailscale tailnet.

Some of the features I care about:

- Watching CPU, RAM, disk and network.
- Watching the metrics history.
- Checking the status of the devices.
- Health checks for websites, ports and DNS.
- Alerts when a server goes offline or a disk is nearly full.
- Watching Docker containers.
- Terminal access and file management from the browser.

Instead of having to SSH into each server to check its status, I can watch the machines in the system from a single interface.

Repository: [https://github.com/manasseh-fikadu/bield](https://github.com/manasseh-fikadu/bield)

**LogDeck – Docker Logging**

For Docker containers, I chose LogDeck to manage logs.

Some features:

- View Docker logs in realtime.
- Store logs so they can be read again after a container restarts or is deleted.
- Search and filter logs.
- Follow logs per container or per Compose project.
- Detect containers that crash or get OOM-killed.
- Configure alerts when certain log patterns appear.
- Manage Docker containers from the web interface.

What I like is that LogDeck has its own log storage built on SQLite, rather than just showing Docker's realtime output.

Thanks to that, when an application fails or a container restarts, I can still find the earlier logs for troubleshooting.

Repository: [https://github.com/AmoabaKelvin/logdeck](https://github.com/AmoabaKelvin/logdeck)

**Grafito – System Logging**

Besides Docker logs, I also wanted an interface to watch logs straight from the Ubuntu Server.

I chose Grafito for that.

Grafito provides a web interface to query and follow the systemd journal.

Some features:

- View system logs in realtime.
- Filter logs by service, priority and time.
- Search log content.
- Follow systemd services.
- Check the status of system services.
- Look at the history of system activity.

Beyond logging, Grafito also has some extras such as a system dashboard, process monitoring and a Docker Compose overview.

For my current needs, I mainly use Grafito to read and troubleshoot Ubuntu system logs.

Repository: [https://github.com/ralsina/grafito](https://github.com/ralsina/grafito)

So monitoring and logging are split by purpose:

- **Bield:** Watching server health and managing the system.
- **LogDeck:** Managing Docker container logs.
- **Grafito:** Watching Ubuntu system logs.

Instead of deploying a fairly large observability stack with Prometheus, Grafana, Alloy and Loki, I wanted to start with small, focused tools that each have their own interface and match what the Homelab actually needs.

## 8. Backup and Recovery

One part you shouldn't skip when self-hosting is backup.

I chose Restic to learn and implement backups for important data.

What needs backing up:

- Infrastructure configuration.
- Docker Compose files.
- Application data.
- Database backups.
- Hermes Agent configuration.
- LogDeck data and configuration.
- Other important data.

Backups should be encrypted, have a retention policy, and be stored somewhere independent of the VPS.

In particular, a backup only really counts once you've successfully restored it.

## 9. Managing Configuration in Git

I gather the configuration and automation into a single repository for easier management.

The goal is to be able to look at the repository and understand how the VPS is configured.

The repository is organized in a modular way, splitting components into separate Ansible Roles and Playbooks so it's easy to maintain, extend and reuse.

The important configuration is all managed with Git so changes can be tracked and redeployed when needed.

**Repository:** [https://github.com/hungpt99-dev/vps-harden](https://github.com/hungpt99-dev/vps-harden)

You can look at the source code, the Ansible structure and the configuration there.

## 10. Conclusion

To me, a Homelab doesn't have to mean a physical server, a Kubernetes cluster or a massive infrastructure setup.

A small VPS running Ubuntu is enough to start exploring a lot of things: Linux, networking, security, Docker, monitoring, logging, automation and self-hosted services.

The most interesting part isn't just having another place to run applications, but understanding better what goes on underneath the systems I use every day.

This will be an environment for continuing to experiment with new technology, building my own services and learning more about running infrastructure.

Does anyone have suggestions or recommendations for interesting tools for this Homelab? 😄
