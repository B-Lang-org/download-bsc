# BSC download/install action

This action downloads and installs BSC from the B-Lang-org/BSC repo.

## Inputs

* `os`
  * **[Required]** The operating system
* `version`
  * The version of BSC (e.g. `2023.07`) to download
    or `latest` to download the latest passing commit on the `main` branch
  * Default: `latest`
* `path`
  * The directory where BSC should be installed, in a new subdirectory called `bsc`
  * Default: the working directory (`./`)
* `debug`
  * Whether to turn on additional debug logging
  * Default: `${{ runner.debug }}`
* `github_token`
  * Personal access token for downloading from the public BSC repository
  * Default: `${{ github.token }}`

## Outputs

* `tag`
  * The version tag of the installed BSC
* `commit`
  * The commit hash of the installed BSC

## Example usage

```yaml
uses: B-Lang-org/download-bsc@v1
with:
  os: ${{ matrix.os }}
  version: 2023.07
  path: ../
```

To access the outputs, assign the step an `id` that can then be referrenced:

```yaml
- name: Download BSC
  id: download
  uses: B-Lang-org/download-bsc@v1
  with:
    os: ${{ matrix.os }}
    version: latest
    path: ../

- name: Build
  run: |
    echo Version tag: ${{ steps.download.outputs.tag }}
    echo Version hash: ${{ steps.download.outputs.commit }}
    export PATH=$PWD/../bsc/bin:$PATH
    bsc -v
```

As shown in the above example, BSC is installed into a directory
called `bsc` below the specified `path`.
