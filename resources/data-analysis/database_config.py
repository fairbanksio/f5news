"""Load read-only database credentials from Vault or the environment."""
import json
import os
from urllib.parse import quote
from urllib.request import Request, urlopen


def load_database_config(settings, source="vault"):
    required = ("mongo_uri", "database", "collection")
    if source == "env":
        values = settings
    elif source == "vault":
        address = settings.get("VAULT_ADDR") or os.environ.get("VAULT_ADDR")
        token = settings.get("VAULT_TOKEN") or os.environ.get("VAULT_TOKEN")
        if not address or not token:
            raise ValueError("Set VAULT_ADDR and VAULT_TOKEN, or select env credentials.")
        mount = settings.get("VAULT_KV_MOUNT") or "kv"
        path = settings.get("VAULT_SECRET_PATH") or "f5.news"
        url = f"{address.rstrip('/')}/v1/{quote(mount, safe='')}/data/{quote(path.strip('/'), safe='/')}"
        try:
            request = Request(url, headers={"X-Vault-Token": token})
            with urlopen(request, timeout=10) as response:
                values = json.load(response)["data"]["data"]
        except Exception:
            raise RuntimeError("Vault read failed. Check its address, token, and KV v2 secret path.") from None
    else:
        raise ValueError("Credential source must be vault or env.")
    if not isinstance(values, dict) or any(not isinstance(values.get(key), str) or not values[key].strip() for key in required):
        raise ValueError("The credential source must contain mongo_uri, database, and collection.")
    return {key: values[key] for key in required}
