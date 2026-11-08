"""Download only the hip-hop (gHO) sequences of the AIST++ annotations (CC BY 4.0).

    python -m dance_rl.aistpp_download --out data/raw/aistpp

The annotations are public GitHub release assets of google/aistplusplus_dataset (v1.0):
keypoints3d.zip (876 MB, COCO-17 3D keypoints at 60 fps, cm) and motions.zip (79 MB, SMPL pose
parameters; the SMPL *body model* is NOT downloaded). Instead of fetching the whole zips, this reads
each zip's central directory with HTTP range requests and pulls only the gHO_* members (a few MB).
No account, token or registration is involved.
"""
from __future__ import annotations

import argparse
import io
import os
import struct
import zipfile
import zlib

import requests

BASE = "https://github.com/google/aistplusplus_dataset/releases/download/v1.0/"
ZIPS = ("keypoints3d.zip", "motions.zip")
SMALL = ("ignore_list.txt",)


class RangeFile(io.RawIOBase):
    """Seekable read-only file over HTTP range requests (enough for zipfile to read the directory)."""

    def __init__(self, url, session):
        r = session.head(url, allow_redirects=True, timeout=60)
        r.raise_for_status()
        self.url = r.url
        self.size = int(r.headers["content-length"])
        self.s = session
        self.pos = 0

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = {0: off, 1: self.pos + off, 2: self.size + off}[whence]
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        n = min(n, self.size - self.pos)
        if n <= 0:
            return b""
        r = self.s.get(self.url, headers={"Range": f"bytes={self.pos}-{self.pos + n - 1}"}, timeout=120)
        r.raise_for_status()
        b = r.content
        self.pos += len(b)
        return b

    def readinto(self, buf):
        b = self.read(len(buf))
        buf[:len(b)] = b
        return len(b)


def fetch_member(rf: RangeFile, info: zipfile.ZipInfo) -> bytes:
    rf.seek(info.header_offset)
    hdr = rf.read(30)
    assert hdr[:4] == b"PK\x03\x04", "bad local header"
    nlen, xlen = struct.unpack("<HH", hdr[26:30])
    rf.seek(info.header_offset + 30 + nlen + xlen)
    raw = rf.read(info.compress_size)
    if info.compress_type == zipfile.ZIP_STORED:
        data = raw
    elif info.compress_type == zipfile.ZIP_DEFLATED:
        data = zlib.decompress(raw, -15)
    else:
        raise ValueError(f"unsupported compression {info.compress_type}")
    assert zlib.crc32(data) & 0xFFFFFFFF == info.CRC, f"CRC mismatch for {info.filename}"
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/raw/aistpp")
    ap.add_argument("--genre", default="gHO")
    a = ap.parse_args()
    s = requests.Session()
    for name in SMALL:
        r = s.get(BASE + name, timeout=60)
        r.raise_for_status()
        os.makedirs(a.out, exist_ok=True)
        open(os.path.join(a.out, name), "wb").write(r.content)
    for z in ZIPS:
        rf = RangeFile(BASE + z, s)
        zf = zipfile.ZipFile(io.BufferedReader(rf, buffer_size=1 << 16))
        members = [i for i in zf.infolist()
                   if os.path.basename(i.filename).startswith(a.genre + "_") and not i.is_dir()]
        print(f"{z}: {len(zf.infolist())} entries, {len(members)} {a.genre} members")
        sub = os.path.join(a.out, z[:-4])
        os.makedirs(sub, exist_ok=True)
        for i in members:
            dst = os.path.join(sub, os.path.basename(i.filename))
            if os.path.exists(dst) and os.path.getsize(dst) == i.file_size:
                continue
            open(dst, "wb").write(fetch_member(rf, i))
        print(f"  -> {sub}")


if __name__ == "__main__":
    main()
