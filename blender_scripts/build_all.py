"""Rebuild every asset family in one Blender session.

    blender --background --factory-startup --python blender_scripts/build_all.py [-- --preview]

Each family script resets the scene before building, so they can run back to back.
"""

import os
import runpy

HERE = os.path.dirname(os.path.abspath(__file__))

for family in ("characters", "nature", "structures", "landmarks", "terrain", "fx"):
    print(f"WG_FAMILY {family}")
    runpy.run_path(os.path.join(HERE, f"{family}.py"), run_name="__main__")
print("WG_DONE")
