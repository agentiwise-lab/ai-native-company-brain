# Implementation Plan

## Slice

Add a Composio-first meeting and CRM ingestion module with routes and dashboard visibility.

## Design

- Add `meeting-crm-composio-ingestion` that wraps the shared Composio ingestion pipeline.
- Support Zoom and Google Meet-derived transcript/recording sources.
- Support Salesforce and HubSpot account/deal/note sources.
- Preserve transcript provenance, participants, time ranges, recording metadata, CRM account/deal context, owners, timestamps, permission metadata, and sensitivity.
- Enforce source scope checks, revoked account blocking, checkpointing, duplicate handling, health/replay compatibility, and native fallback gating for missing ACL/delta/webhook fidelity.
- Add API routes for meeting/CRM sync and status.
- Add dashboard visibility for meeting/CRM artifacts, checkpoints, runs, and restricted/fallback posture.

## Boundaries

- Google Meet is modeled as a derived source because transcripts commonly arrive via calendar/drive/recording systems.
- This slice gates native fallback requirements; it does not implement provider-native adapters.
