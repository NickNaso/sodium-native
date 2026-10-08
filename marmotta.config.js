const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = __dirname
const deps = path.join(root, 'build', 'deps')

const LIBSODIUM = ['https://github.com/jedisct1/libsodium', 'e18eee6']
const LIBJSTL = ['https://github.com/holepunchto/libjstl', '098664c']

module.exports = async ({ target, platform, arch }) => {
  const host = resolveHost(target, platform, arch)

  const sodium = fetchRepo('sodium', ...LIBSODIUM)
  const jstl = fetchRepo('jstl', ...LIBJSTL)
  const node = await fetchNodeHeaders(host)

  // libsodium ships a pre-generated version header for builds without autotools
  fs.copyFileSync(
    path.join(sodium, 'builds', 'msvc', 'version.h'),
    path.join(sodium, 'src', 'libsodium', 'include', 'sodium', 'version.h')
  )

  const sodiumInclude = path.join(sodium, 'src', 'libsodium', 'include')

  // Marmotta only compiles C/C++ sources, so libsodium's assembly (.S) files are
  // left out and the portable C implementations are used instead
  const sources = [
    binding('binding.cc'),
    ...glob(path.join(sodium, 'src', 'libsodium'), '.c'),
    binding('extensions/tweak/tweak.c'),
    binding('extensions/pbkdf2/pbkdf2.c')
  ]

  return {
    name: 'sodium-native',
    sources,
    includeDirs: [
      root,
      sodiumInclude,
      path.join(sodiumInclude, 'sodium'),
      path.join(jstl, 'include'),
      path.join(root, 'node_modules', 'bare-compat-napi', 'include'),
      node.include
    ],
    cFlags: sodiumFlags(host),
    cxxFlags: ['-std=c++20', '-DSODIUM_STATIC=1', '-DNAPI_VERSION=9'],
    linkerFlags: linkerFlags(host, node),
    outputDir: path.join('prebuilds', `${host.platform}-${host.arch}`)
  }
}

function binding(file) {
  return path.join(root, file)
}

function resolveHost(target, platform, arch) {
  if (!target) {
    return {
      platform,
      arch,
      os: { win32: 'windows', darwin: 'macos', linux: 'linux' }[platform] || platform,
      nodeArch: arch
    }
  }

  const [machine] = target.split('-')
  const os = /windows/.test(target) ? 'windows' : /macos|darwin/.test(target) ? 'macos' : 'linux'

  const resolved = /^(x86_64|amd64)$/.test(machine)
    ? 'x64'
    : /^(aarch64|arm64)$/.test(machine)
      ? 'arm64'
      : machine

  return {
    platform: { windows: 'win32', macos: 'darwin', linux: 'linux' }[os],
    arch: resolved,
    os,
    nodeArch: resolved
  }
}

function sodiumFlags({ os, arch }) {
  const flags = [
    '-DSODIUM_STATIC=1',
    '-DCONFIGURED=1',
    '-DDEV_MODE=1',
    '-DHAVE_ATOMIC_OPS=1',
    '-DHAVE_C11_MEMORY_FENCES=1',
    '-DHAVE_GCC_MEMORY_FENCES=1',
    '-DHAVE_INLINE_ASM=1',
    '-DHAVE_INTTYPES_H=1',
    '-DHAVE_STDINT_H=1',
    '-DHAVE_TI_MODE=1',
    '-DNATIVE_LITTLE_ENDIAN=1'
  ]

  if (os !== 'windows') {
    flags.push(
      '-D_GNU_SOURCE=1',
      '-DHAVE_CET_H=1',
      '-fvisibility=hidden',
      '-fno-strict-aliasing',
      '-fwrapv',
      '-flax-vector-conversions'
    )
  }

  if (os === 'macos') {
    flags.push(
      '-DASM_HIDE_SYMBOL=.private_extern',
      '-DTLS=_Thread_local',
      '-DHAVE_ARC4RANDOM=1',
      '-DHAVE_ARC4RANDOM_BUF=1',
      '-DHAVE_CATCHABLE_ABRT=1',
      '-DHAVE_CATCHABLE_SEGV=1',
      '-DHAVE_CLOCK_GETTIME=1',
      '-DHAVE_GETENTROPY=1',
      '-DHAVE_GETPID=1',
      '-DHAVE_MADVISE=1',
      '-DHAVE_MEMSET_S=1',
      '-DHAVE_MLOCK=1',
      '-DHAVE_MMAP=1',
      '-DHAVE_MPROTECT=1',
      '-DHAVE_NANOSLEEP=1',
      '-DHAVE_POSIX_MEMALIGN=1',
      '-DHAVE_PTHREAD=1',
      '-DHAVE_PTHREAD_PRIO_INHERIT=1',
      '-DHAVE_RAISE=1',
      '-DHAVE_SYSCONF=1',
      '-DHAVE_SYS_MMAN_H=1',
      '-DHAVE_SYS_PARAM_H=1',
      '-DHAVE_SYS_RANDOM_H=1',
      '-DHAVE_WEAK_SYMBOLS=1'
    )
  }

  if (os === 'linux') {
    flags.push(
      '-DASM_HIDE_SYMBOL=.hidden',
      '-DTLS=_Thread_local',
      '-DHAVE_CATCHABLE_ABRT=1',
      '-DHAVE_CATCHABLE_SEGV=1',
      '-DHAVE_CLOCK_GETTIME=1',
      '-DHAVE_GETPID=1',
      '-DHAVE_MADVISE=1',
      '-DHAVE_MLOCK=1',
      '-DHAVE_MMAP=1',
      '-DHAVE_MPROTECT=1',
      '-DHAVE_NANOSLEEP=1',
      '-DHAVE_POSIX_MEMALIGN=1',
      '-DHAVE_PTHREAD_PRIO_INHERIT=1',
      '-DHAVE_PTHREAD=1',
      '-DHAVE_RAISE=1',
      '-DHAVE_SYSCONF=1',
      '-DHAVE_SYS_AUXV_H=1',
      '-DHAVE_SYS_MMAN_H=1',
      '-DHAVE_SYS_PARAM_H=1',
      '-DHAVE_SYS_RANDOM_H=1',
      '-DHAVE_WEAK_SYMBOLS=1'
    )
  }

  if (os === 'windows') {
    flags.push('-D_CRT_SECURE_NO_WARNINGS=1', '-DHAVE_RAISE=1')
  }

  if (arch === 'x64') {
    flags.push(
      '-DHAVE_CPUID=1',
      '-DHAVE_RDRAND=1',
      '-DHAVE_EMMINTRIN_H=1', // SSE2
      '-DHAVE_PMMINTRIN_H=1', // SSE3
      '-DHAVE_TMMINTRIN_H=1', // SSSE3
      '-DHAVE_SMMINTRIN_H=1', // SSE4.1
      '-DHAVE_WMMINTRIN_H=1', // AES
      '-DHAVE_AVXINTRIN_H=1', // AVX
      '-DHAVE_AVX2INTRIN_H=1', // AVX2
      '-DHAVE_AVX512FINTRIN_H' // AVX512F
    )
  }

  if (arch === 'arm64') flags.push('-DHAVE_ARMCRYPTO=1')

  return flags
}

function linkerFlags({ os }, node) {
  if (os === 'linux') return ['-Wl,-z,noexecstack']

  // `uv_*` symbols live in node.exe, so link against the node import library
  if (os === 'windows') return [node.lib]

  return []
}

function glob(dir, ext) {
  const found = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)

    if (entry.isDirectory()) found.push(...glob(file, ext))
    else if (entry.name.endsWith(ext)) found.push(file)
  }

  return found.sort()
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] })
    .toString()
    .trim()
}

function fetchRepo(name, url, commit) {
  const dir = path.join(deps, name)

  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(deps, { recursive: true })
    git(deps, 'clone', '--quiet', '--filter=blob:none', url, name)
  }

  if (!git(dir, 'rev-parse', 'HEAD').startsWith(commit)) {
    git(dir, 'checkout', '--quiet', '--force', commit)
  }

  return dir
}

// Marmotta ships the Node-API headers only, but `binding.cc` also needs
// `uv.h` and `node_version.h` from the full Node.js headers
async function fetchNodeHeaders({ os, nodeArch }) {
  const version = process.version
  const dir = path.join(deps, `node-${version}`)
  const include = path.join(dir, 'include', 'node')

  if (!fs.existsSync(include)) {
    fs.mkdirSync(dir, { recursive: true })

    const archive = path.join(dir, 'headers.tar.gz')

    await download(`https://nodejs.org/dist/${version}/node-${version}-headers.tar.gz`, archive)

    // Relative paths: GNU tar reads `C:\...` as a remote host
    execFileSync('tar', ['-xzf', path.basename(archive), '--strip-components=1'], {
      cwd: dir,
      stdio: 'inherit'
    })

    fs.rmSync(archive)
  }

  let lib = null

  if (os === 'windows') {
    lib = path.join(dir, `node-win-${nodeArch}.lib`)

    if (!fs.existsSync(lib)) {
      await download(`https://nodejs.org/dist/${version}/win-${nodeArch}/node.lib`, lib)
    }
  }

  return { include, lib }
}

async function download(url, file) {
  const res = await fetch(url)

  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`)

  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
}
