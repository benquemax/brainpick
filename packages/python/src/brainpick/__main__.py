"""`python -m brainpick` — the CLI without the console script."""
import sys

from brainpick.cli import main

if __name__ == "__main__":
    sys.exit(main())
