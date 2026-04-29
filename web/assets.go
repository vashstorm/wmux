package web

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed all:dist
var embeddedAssets embed.FS

func StaticFileSystem() (http.FileSystem, error) {
	distFS, err := fs.Sub(embeddedAssets, "dist")
	if err != nil {
		return nil, err
	}

	return http.FS(distFS), nil
}
