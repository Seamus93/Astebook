"""Validate the source gateway binding without secrets or a Docker daemon.
Inputs: repository Compose source. Returns: exit zero on the assigned binding.
Side effects: invokes Compose config only. Errors: rejects exposure or port drift.
"""
import json
import subprocess

model = json.loads(subprocess.check_output(
    ["docker", "compose", "config", "--no-interpolate", "--format", "json"], text=True
))
ports = model["services"]["app"]["ports"]
expected = [("127.0.0.1", "3010", 3000, "tcp")]
actual = [(item.get("host_ip"), str(item.get("published")), int(item["target"]), item.get("protocol", "tcp")) for item in ports]
if actual != expected:
    raise SystemExit(f"Unexpected gateway binding: {actual!r}; expected {expected!r}")
print("Gateway binding verified: 127.0.0.1:3010:3000")
