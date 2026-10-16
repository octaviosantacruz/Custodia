"""Field names of the SIA target-sets payload.

Shape confirmed on 2026-10-02 with a read-only probe of ``GET /api/targetsets``
(key names and types only, no values): ``target_sets[]`` items carry ``name``,
``type``, ``description`` (may be null), ``provision_format``,
``enable_certificate_validation`` (bool), ``secret_id`` and ``secret_type``
(the last two are never mapped). ``b64_last_evaluated_key`` is null on the last
page. Forwarding that cursor as a query parameter is still unverified: the
tenant only has one target set.
"""

TARGET_SETS_ITEMS_KEY = "target_sets"
TARGET_SETS_CURSOR_KEY = "b64_last_evaluated_key"

TARGET_SET_NAME_KEY = "name"
TARGET_SET_TYPE_KEY = "type"
TARGET_SET_DESCRIPTION_KEY = "description"
TARGET_SET_PROVISIONING_FORMAT_KEY = "provision_format"
TARGET_SET_CERTIFICATE_VALIDATION_KEY = "enable_certificate_validation"
