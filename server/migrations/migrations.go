// Package migrations holds Custodia's schema history. It is applied only by
// `custodia migrate up`, never by the server on start.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
