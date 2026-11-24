# Releasing & Updates Guide — Luna RP Android

This project builds and signs signed Android APKs remotely via GitHub Actions (`ATMRaven/luna-rp-android`).

## One-Command Release

```bash
npm run release:android -- [patch|minor|major]
```

## Required GitHub Secrets & Variables

| Type | Name | Purpose |
| :--- | :--- | :--- |
| **Secret** | `ANDROID_KEYSTORE_BASE64` | Base64-encoded release `.keystore` file |
| **Secret** | `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| **Secret** | `ANDROID_KEY_ALIAS` | Key alias (`release-key`) |
| **Secret** | `ANDROID_KEY_PASSWORD` | Key password |
| **Variable** | `ANDROID_CERT_SHA256` | Certificate SHA-256 fingerprint |
