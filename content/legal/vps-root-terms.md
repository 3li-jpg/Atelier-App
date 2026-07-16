# Cloud VPS Root-Access Terms

Effective: 2026-07-16 · Version 1.0

> This is a draft, not legal advice. It must be reviewed by qualified counsel before publishing. Items marked `[LEGAL REVIEW: ...]` require a human decision.

---

## 1. The VM runs as root and is yours to operate

When you subscribe to a Cloud VPS plan, Atelier provisions a persistent virtual machine on which you are granted **root access**. The machine is yours to operate: you install software, configure services, run workloads, and manage it as you see fit within the limits of these terms.

## 2. You are solely responsible for what you run

Because you have root access, you bear full responsibility for everything executed on the VM, including the software you install, the data you store, the network services you expose, and any consequences to the machine or third parties. Atelier does not monitor, curate, or assume responsibility for the contents or behavior of your VM beyond the infrastructure needed to provision and bill it.

## 3. Acceptable use

You must operate the VM in compliance with Atelier's Acceptable Use Policy, the Terms of Use, and the policies of the underlying compute provider. You must not use the VM to infringe IP rights, distribute malware, attack other systems, send unsolicited communications, or host unlawful content. `[LEGAL REVIEW: cross-reference the AUP; if no standalone AUP exists, confirm the acceptable-use clause in the Terms of Use is sufficient and link it here.]`

## 4. Security responsibility

With root access comes responsibility for the security of the VM: patching, access control, firewalling, and backups. Atelier is not responsible for compromise resulting from how you configure or operate your machine. You should not assume the VM is hardened by default.

## 5. Data persistence and deletion

The VM is persistent: data you place on it remains until you destroy it or until the machine is reclaimed. When you cancel your subscription, the VM is destroyed after a grace period (see [data-retention.md](./data-retention.md)). You are responsible for backing up any data you wish to keep before cancellation; data on a destroyed VM is not recoverable.

## 6. Acceptance

By launching a Cloud VPS, you confirm that you understand the VM runs as root, that it is yours to operate, and that you accept the responsibilities described above. This acceptance is recorded when you confirm the root-access terms at launch.

**Effective:** 2026-07-16 · **Version:** 1.0
