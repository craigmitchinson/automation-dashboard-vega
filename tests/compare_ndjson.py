"""Compares two NDJSON files document by document (numbers to 6 dp)."""
import json, sys
def norm(x):
    if isinstance(x, dict): return {k: norm(v) for k, v in x.items()}
    if isinstance(x, list): return [norm(v) for v in x]
    if isinstance(x, float): return int(x) if x.is_integer() else round(x, 6)
    return x
a = [norm(json.loads(l)) for l in open(sys.argv[1])]
b = [norm(json.loads(l)) for l in open(sys.argv[2])]
diff = sum(1 for x, y in zip(a, b) if x != y) + abs(len(a) - len(b))
print(f"{len(a)} vs {len(b)} documents, {diff} differ")
sys.exit(1 if diff else 0)
