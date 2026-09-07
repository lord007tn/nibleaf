# Project access and member controls

These screenshots review static access states and permission controls. The member captures render the actual MembersSection source and design-system CSS against synthetic hook data and example.com identities. The before capture uses the unmodified main-branch component. The access after captures render the actual ProjectAccessBoundary with a mocked 404. Translation text comes from the repository English and Arabic dictionaries. These local component captures are not deployment or live authorization proof.

The access before screenshot is a production Chrome capture of an inaccessible disposable project: no project content was disclosed, but the empty editor and tools were misleading. A separate authenticated production check confirmed project, language, branch, page and comment endpoints each returned HTTP 404 with only an error envelope and no data. Server authorization is unchanged by this PR.

| State | Before | After |
| --- | --- | --- |
| Inaccessible project, Arabic 320px | [Empty editor](access-before-ar-320.png) | [Not found](access-ar-320.png) |
| Editor membership, Arabic 320px | [Admin controls visible](members-before-ar-320.png) | [Read-only roles](members-after-ar-320.png) |
| Editor membership, English 1440px | [Admin controls visible](members-before-en-1440.png) | [Read-only roles](members-after-en-1440.png) |

[English access state](access-en-1440.png) and [admin controls retained](admin-en-1440.png) complete the seven-view local matrix. [Browser measurements](browser-checks.json) confirm language/direction, role controls and no horizontal overflow. No motion or timed interaction changed, so static screenshots and behavioral regression tests provide the relevant review evidence.
