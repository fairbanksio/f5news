# Local Analysis Stack

Copy `.env.example` to the ignored `.env` and fill in unique credentials. Generate passwords with `openssl rand -hex 24`. Use a development MongoDB account with only the permissions needed for analysis.

Published ports bind to `127.0.0.1`. Keep them local. The Spark cluster does not authenticate workers, so do not forward its ports or attach untrusted containers to its network.

Earlier revisions committed MinIO and MySQL defaults. Replace those credentials in any existing local deployment using the services' supported credential-change procedures before restarting with new values. Updating `.env` alone does not rotate an initialized database user.

A MongoDB credential also appeared in Git history. Its owner must revoke it in Atlas and verify revocation. Removing it from the current notebook does not revoke it. Do not test the historical credential against the service.
