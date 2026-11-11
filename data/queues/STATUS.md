# Queue status

Run review of 2026-11-10 (the team finished all course-audio runs on 10-11 Nov). Generated from data/queues/c###.csv, data/media-manifest.json and data/queues/failed-review.csv; no run logs were available (no gh CLI).

- queued = data rows of data/queues/c###.csv (ids already in the manifest when the queue was built are not in it).
- converted = the drive_file_id has an entry in data/media-manifest.json (any status). approved = that entry has status approved.
- failed = id listed in data/queues/failed-review.csv (8 Nov) that still has NO manifest entry. The reason is not recorded in the repo.
- not started = no manifest entry and not in failed-review.csv (never converted, or failed without a record: unknown).
- DONE = every queued lesson is converted or failed. Queues with 0 data rows are EMPTY and not counted.

Totals over 66 non-empty queues: queued 3810 · converted 2963 · approved 0 · failed 10 · not started 837.

## (a) DONE (7)

| course | teacher | title | queued | converted | approved | failed | not started |
|---|---|---|---|---|---|---|---|
| c012 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | 7-A.S.បរិច្ឆេទ ទី១ (២០២៣) | 168 | 158 | 0 | 10 | 0 |
| c013 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | 8-A.S.បរិច្ឆេទ ទី៣ (២០២៤) | 64 | 64 | 0 | 0 | 0 |
| c048 | លោកម្ចាស់គ្រូ គម្ភីរវិចារណោ វិញ សុវឿង | 3-បរិច្ឆេទទី​៣ (ឆ្នាំ ២០២៤) | 70 | 70 | 0 | 0 | 0 |
| c057 | លោកម្ចាស់គ្រូ មុនីចរិយាវង្ស ហ៊ុន ខេមរា | 1-បច្ចេកទេសព្យាបាលជម្ងឺផ្លូវចិត | 51 | 51 | 0 | 0 | 0 |
| c065 | លោកម្ចាស់គ្រូ កិត្តិប្បញ្ញោ ថូ ចន្ថា | 1-សតិបដ្ឋាន | 54 | 54 | 0 | 0 | 0 |
| c072 | អ្នកគ្រូសិរីសុធម្មៈ ជោតិកា ម៉ម សុខហេង | 1-បិដកលេខ ១៤ | 24 | 24 | 0 | 0 | 0 |
| c083 | លោកម្ចាស់គ្រូ ឡេង ស៊ីដែន | 3-បាលីប្រែលោតប្រយោគ បរិច្ឆេទ ទី | 9 | 9 | 0 | 0 | 0 |

## (b) STARTED (41)

| course | teacher | title | queued | converted | approved | failed | not started |
|---|---|---|---|---|---|---|---|
| c001 | លោកម្ចាស់គ្រូ ពុទ្ធិកាលង្ការ ផេង ឌីណា | 1-បរិច្ឆេទ ទី ៨ | 57 | 26 | 0 | 0 | 31 |
| c006 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | 1-បរិច្ឆេទ ទី១ កាត់ស្អាត (២០២២) | 174 | 171 | 0 | 0 | 3 |
| c007 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | 2-A.S.បរិច្ឆេទ ទី២ កាត់ស្អាត(២០ | 58 | 55 | 0 | 0 | 3 |
| c008 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | 3-បរិច្ឆេទ ទី៣ កាត់ស្អាត(២០២៥) | 55 | 54 | 0 | 0 | 1 |
| c009 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | 4-បរិច្ឆេទ ទី៤ កាត់ស្អាត(២០២៥) | 63 | 39 | 0 | 0 | 24 |
| c011 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | 6-បរិច្ឆេទ ទី៦ កាត់ស្អាត(២០២៤) | 55 | 53 | 0 | 0 | 2 |
| c014 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | 9-A.S.បរិច្ឆេទ ទី៤(២០២២) | 64 | 50 | 0 | 0 | 14 |
| c015 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | 10-A.S.បរិច្ឆេទ ទី៤(២០២៤) | 71 | 62 | 0 | 0 | 9 |
| c016 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | 11-A.S.បរិច្ឆេទ ទី៥(២០២២) | 82 | 78 | 0 | 0 | 4 |
| c017 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | 12-A.S.បរិច្ឆេទ ទី៦​(២០២៣) | 66 | 65 | 0 | 0 | 1 |
| c018 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | A.S.បរិច្ឆេទ ទី៧ (២០២៣) | 119 | 115 | 0 | 0 | 4 |
| c019 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | 13-A.S.បរិច្ឆេទ ទី៨ (២០២៥) | 139 | 132 | 0 | 0 | 7 |
| c020 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | 14-A.S.បរិច្ឆេទ ទី៩ (២០២០) | 41 | 39 | 0 | 0 | 2 |
| c021 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | 15-A.S.ព្រះធម៌ថ្នាក់កុមារ (២០២៤ | 53 | 35 | 0 | 0 | 18 |
| c023 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | តេមិយជាតក | 4 | 3 | 0 | 0 | 1 |
| c025 | លោកម្ចាស់គ្រូ ធម្មសេនា ហាក់ សៀងហៃ | 1-Dhamma in English( វគ្គ ១) | 58 | 49 | 0 | 0 | 9 |
| c026 | លោកម្ចាស់គ្រូ ធម្មសេនា ហាក់ សៀងហៃ | 2-Dhamma in English(វគ្គ ២) | 33 | 32 | 0 | 0 | 1 |
| c031 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | 7-បិដកលេខ២២ | 40 | 35 | 0 | 0 | 5 |
| c032 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | ព្រះត្រៃបិដកបាលីភាគ១៦ | 23 | 19 | 0 | 0 | 4 |
| c033 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | ព្រះត្រៃបិដកបាលីភាគ១៧ | 24 | 2 | 0 | 0 | 22 |
| c035 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | ព្រះត្រៃបិដកបាលីភាគ១៩ | 30 | 24 | 0 | 0 | 6 |
| c036 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | ព្រះត្រៃបិដកបាលីភាគ២០ | 91 | 75 | 0 | 0 | 16 |
| c037 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | 6-បិដកលេខ២១ | 24 | 22 | 0 | 0 | 2 |
| c039 | លោកម្ចាស់គ្រូ សាសនមុនី ហ៊ឹម ប៊ុនធឿន | 1-ថ្នាក់សមថៈ វិបស្សនា​២០២២ | 39 | 36 | 0 | 0 | 3 |
| c042 | លោកម្ចាស់គ្រូ សាសនមុនី ហ៊ឹម ប៊ុនធឿន | 4-វគ្គខ្លីលើកទី ១ នៅកែប | 18 | 4 | 0 | 0 | 14 |
| c043 | លោកម្ចាស់គ្រូ សាសនមុនី ហ៊ឹម ប៊ុនធឿន | 5-សមាធិ វគ្គខ្លី | 166 | 148 | 0 | 0 | 18 |
| c044 | លោកម្ចាស់គ្រូ ពុទ្ធង្កុរ ភុល ណារិន | 1-វិនយបិដកេ មហាវគ្គបាឡិ  | 67 | 61 | 0 | 0 | 6 |
| c047 | លោកម្ចាស់គ្រូ គម្ភីរវិចារណោ វិញ សុវឿង | ០០​​​​​​​​​ ព្រះអភិធម្មថ្នាក់ដំបូង ថ្ងៃបើកថ្នាក់ដំបូង | 100 | 97 | 0 | 0 | 3 |
| c049 | លោកម្ចាស់គ្រូ គម្ភីរវិចារណោ វិញ សុវឿង | 4-បរិច្ឆេទទី៤ វិថីសង្គហវិភាគ (ឆ | 142 | 132 | 0 | 0 | 10 |
| c054 | លោកម្ចាស់គ្រូ មុនីបុត្តោ សុខ ធាវី | 1-Buddhism in English for Begin | 57 | 47 | 0 | 0 | 10 |
| c058 | លោកម្ចាស់គ្រូ មុនីចរិយាវង្ស ហ៊ុន ខេមរា | 2-ញាណទស្សនៈ (២០២៦) | 37 | 30 | 0 | 0 | 7 |
| c068 | លោកម្ចាស់គ្រូ សុភប្បញ្ញោ ស រដ្ឋា | 1-Buddhism in English Level 1 b | 22 | 19 | 0 | 0 | 3 |
| c069 | លោកម្ចាស់គ្រូ សុភប្បញ្ញោ ស រដ្ឋា | 2-Buddhism in English Level 2 b | 27 | 1 | 0 | 0 | 26 |
| c070 | លោកម្ចាស់គ្រូ សុភប្បញ្ញោ ស រដ្ឋា | 3-Buddhism in English Level 3 b | 30 | 22 | 0 | 0 | 8 |
| c073 | អ្នកគ្រូសិរីសុធម្មៈ ជោតិកា ម៉ម សុខហេង | 2-បិដកលេខ ១៥ | 26 | 19 | 0 | 0 | 7 |
| c074 | អ្នកគ្រូសិរីសុធម្មៈ ជោតិកា ម៉ម សុខហេង | 3-រាត្រីធម្មទាន | 463 | 453 | 0 | 0 | 10 |
| c075 | អ្នកគ្រូសិរីសុធម្មៈ ជោតិកា ម៉ម សុខហេង | 4-នាទីធម្មចរិយា | 76 | 72 | 0 | 0 | 4 |
| c076 | អ្នកគ្រូសិរីសុធម្មៈ ជោតិកា ម៉ម សុខហេង | 5-អដ្ឋកថាជាតក | 33 | 31 | 0 | 0 | 2 |
| c077 | អ្នកគ្រូសិរីសុធម្មៈ ជោតិកា ម៉ម សុខហេង | 6-បច្ចេកពុទ្ធ | 57 | 55 | 0 | 0 | 2 |
| c078 | អ្នកគ្រូសិរីសុធម្មៈ ជោតិកា ម៉ម សុខហេង | 8-វចនានុក្រមព្រះពុទ្ធសាសានា | 72 | 68 | 0 | 0 | 4 |
| c080 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | វេស្សន្តរជាតក | 5 | 3 | 0 | 0 | 2 |

- c001 not started: 1sSkn0-c_Tn86LqhPSuv-yiSnTNGrQZxz, 182P_ouVV3nRacNOi8zwJEgNtUo7o0iXH, 1UFlByUN-ctM5oCCzltPzk0RHY6ngeRzg, 1C3Kx9-JccQOh6H9Hy1FUxO7p7Z0E_l60, 1_DPBO3-9_7ZZ9rwlzeqwqokERHF7NIwR, 1M0qXqGw3yXVMEEfKpRnkDe1etEm6rBS0, 1t8peNM1L_NAuLVl4HmC2-M5zDkoyTwO1, 16-ei0rO6HRUriVlxtqWbQSNkqHYXVdjh, 1aLSO-KpNX_pfdO7OalTsQhoJODzUAIhT, 1LgsA0XO9Cm5-t6Wg_gxjQRSmRpTcAlZY, 1MTCICvEsZ3xndFG2UXgjsuQ17tgEwqdo, 1Q2xtqcnY3At_d-K-6LE92fQr6WZmWqZi, 1PPUZyBX2nquMxJx2t0kj-e9X3u1oPQJ-, 1nTCOrGDPyR1OBDuSXziNaePPbs6oSXhl, 1nKFeKzMfc0DRtodSDjLNlb4CJ-MpDvAw, 1SE1HuA2CKciLRqlhf9jfZiYLc2q03A7s, 1P1SU7FEiQWzbZ_4mP1Eu2peK6jQ0dRIA, 1jr6i3dgWpvK949iC8sjmtbhMqdpcnRZz, 1Wm66JFEienXqedkyd5TdK8CXvbGPLKKS, 1hom67debN-3YU4EQMuYCcjsFKFyJs6Sp, 1Ud6eiazsrIDpAS0i2RASzEwg0KO2NMhW, 1b4o-PkUmP1iNo2zVDLoe2a_fLtIf8TVn, 1fBon0Gw0jde-iJUgMhj64a-aXvSALP_M, 1Pw49M1X2LbyWz5Tg0ki11koHqXNIHuLx, 17hK1qXcMULTLnZqOj_bEv-Meq3OIUG2d, 1qsjlVLLSdTn1dR_jTXYONyCtvo5QIG-c, 1MCCdHxPi_PiWkV8-n2krynUB7oWd9rk_, 1O9kqjZKkl6r9IhwgTwZbdTSZBaIQXirT, 1wU_46R3q3al2nvaDYQPFSMQMTAfIG475, 1EWcE1I5ZJAj0UReogdI5s_WgaCRWDpKR, 1wWL_FFw82ss6JCJyyRjIdLmOwlWn6pUv
- c006 not started: 1DxorTGkzawOOSgV4NR7K-GNMBTWFvEug, 1gt3fST0_Q3K1kn6k0EFtRuV9-6VsXoLw, 11iiE7-9uFhppeDSTFTEQsEQlc4gWbxoc
- c007 not started: 1iO1LTtIZyeRPSqgYoyL0PnYvAHmbblGC, 1JKfx2ug5qBRUGx_EZYREaOeHYv06YTn5, 1R7fZ4c8W3ogzmjxl61bum9GZ647HdHeh
- c008 not started: 1oW4psmZh7WQ7de-_5WMtt9TKL9chhNlL
- c009 not started: 1btuhpTxTneOu9QJe2kXcC7zmjrnG4b5I, 1Vb_v4bmc_d7IEAPqbjOdcmKPshNJFIyV, 1dUSge-0rKOL6LUYXA6Vv02OZaj_z887q, 1LBCXj-CuT1FFwNCnQkoznfnh_-d2qmER, 1o3YlBzv3H4-k6-v54vukRUG1utyPPnTH, 1IWAuDjOVbVtIFT70MiM0k3rtpk5B00yN, 1L5_gHrSW1Aw7EWGkg0DJ9nHl2ublbvyi, 12a9LpTVnZF8koJRdEpPnfV1TnCGjwjT4, 1ZkJbpr4gKxw1st2wehM3k3Zyo1bl33bn, 1x-AAoi6L7WR-5JJTn_aOmjUZlYJoyp7-, 1venowzVk7KAqTFy6Q2tuhh64wQh47lFg, 1O3Et3YSNyOW4UgMVqQPx1RFERfkW8MrU, 1T-X5lOdiOs4s9LVJ_jtlrqyWXAY8Wjkj, 14oHKYGKlHd9vH3rBLOA46ge1P5KBhnG7, 1ubWrHdk22aCMCAKacVedYWDSZxUxnUyv, 1_7cXNY4R_wPasE5GRsOeO_MpAKUo8Vkz, 10knHXIPtPI-64fyGnuOanp4AZO1T7wGB, 1lIgZxC8ji64Vp-e3TEKEJD_xm58pgIm8, 12HqpGjwGrWK3JhvEQNjWfTh3ffdWkH2p, 1lS0bBGZGFNRlbWSdvHskbZ9Bo-zy2F26, 1WA12AM3esBQZsmXWGnAjmC40gtrLGUcU, 1jaGthkoTgJAGABQXw6ireU39YePs9TRp, 1CtKb0cJKaYKQOjMD_W7wOmBq4_eNM-N8, 1wt4Fjq27mN3ud7JpOBYscVBmthMleP34
- c011 not started: 1KzQTePtEk8PXYe-_IawPCfyrQb1GkBCB, 1vpAjef20CLZQge75wNDCLT-ck_cdabtz
- c014 not started: 17jonLFIulfoI_odZkVyRoafIHL4b2p9x, 1kIbAxLwytqowxWr0fbNceqL80zyWX7xH, 1eKepcRLDESSGfOAJ3-xKtcfnWEvyx8Yw, 1KJLhMwNItauPH30YJswMVVnITZInNnrb, 1hvP93hgj2J7zQQouW7Z5wlE7ms82Wk2G, 1B8UnxNV9mTrtzm4ViV8wGNOemjMXWP8O, 1x0oViw4ZTORf9EwxRW7rJkSfz2pzppm0, 16gJIWHOlbUz7uMIsn76Uq48PnqyJPS6x, 1wLhZ_ZZwySY-6oUZP_Z4SID8zsGEoVTx, 1JRaV0k5CYBpxsztnSYQxADBnCMCnCeMx, 1HC5oprKGnuLAhC8I_Fm3sqkLx0uvwC7v, 1bXA_0n_qQJf18zSROFxXfRe-rMw6f8Wj, 12pB_HEoBlvaY4bIhENKIf91ZEVtHUgSv, 1UgO71JWO-bhrmR1OECcq8xh_ZLKNPF1C
- c015 not started: 1QL1-Q9R00YjaNMCRQLTJmU5bascyAWf4, 11NTJ9YlNP_7GwJTfmx4SMaTLijPo_vNF, 1sOuAM6kw3MOHleYnWZAyUjwW-2fPhcv6, 1TvSIuGfBuN2wSWKo3ePCPnCl_vJF2a_O, 11AjgqeO7aCCm4nHtD17CGBOhOnpUP_rB, 1TWm4IsZT52yQiD-7_qA2RBqlh4tQIK6o, 1gr2OBuSB-jIDehjjepzXOy7kl065Xpz1, 1KMdkKeX07WlgA0B3dBQHDyh_i1ZTEMXC, 1bevyYohbRKYoaadR2b-Vh-8b7auAzQA-
- c016 not started: 1XcE1ly7m3DhOB_6SnVwvHV8hBoXBYsN6, 1_x0IkzbmWKdTLbcewtsgtlfETeMBr-Yd, 1g3_7xCYsh5voL9-Vc0n6yTH78bM_QJdt, 1neEbGrYKEgYoHjXUgSO4Ka90p-VTwSei
- c017 not started: 1eh0yHN6mYgqPg6wlCoXrzaWwzkYetwlx
- c018 not started: 1Q8YRfKGHjBnX3ipiAMqPF3LmWAlFMkkX, 1OJpu2f9Krqd7YPZiT-n0adDWOvA1WURs, 1fQpyfLjcJZtAuR99Ok7v1cYXL7CcGhcD, 1kmE7DNDB4zCioof1v6ZsBsZ18qegr3ia
- c019 not started: 1k46kSX1OVvzjrT1tf1R4F35dr0Y3Egtl, 1gGL3jEW5jgSOHq04ygZdbZFtq-2vzcyZ, 1wfJ_tJIEXE5Zy1nEv-gJKWFjJxZ2atFX, 1G4X_0gNIGKa94KtWYf2oBCySuCqemSCw, 14TDWOHBaY-1IGL4IFJaO8VReKT6UW9x-, 1HkMzaQPZrveCX7H3nvR7BWDsRrpsptjH, 1YF84GsE_kTsE7-xjopwrNEIe5aDK6yBc
- c020 not started: 1JVDqcYpuJKLIAJ012_zchGLEmjNer-51, 1qzWA8p5LVsvy6tOpV_WjQt-jgTD4VHZ7
- c021 not started: 1tmbNJe6LTKnsFLabUIlYEGeYEHAOgLvu, 1qKLX6y7Mt41RDBnhBC9eJClCdw_R2h0V, 1ZzIPf--YQRwOQdl-664bJPKb343N3XB7, 1KGfH5zDJbE_xiA6rNOThbnypexo5XKBW, 1qdDIOPlKUBEHuqS6HzNVyr6InUAEo2O1, 1jd3vnMTMcTbnI_LjT8bHKmIfl8Ce-FQh, 1dwy_F8QKKHMd7yDY8cKvATaF5LjIkUFm, 1O7gsEqW1rgRdViLQjnRfFySsDNAN7oVM, 1jV81tN2N3CwYAW2hlJy1WoCjevEPTntx, 133EJbrFa9X51YBK-tkluFb24Qo7SECKY, 1lWolSWA8oL6WGlnnZJAXE2FGLgQREO0W, 1AoWX1ZBVB-rmhc3Msgi7Rm2ep8xSCs7J, 1RvGawUOo2sN282L6wEdgKf1i6aJl89qA, 1ziT6hz84BKUPJUI3z7JaIzUORca9Rmyo, 1RtGeOpXkdq8XcQkGCkDjHvz24DBO644f, 1XkUi-2GsDEhox_ZrSxmxlt0N4ZiwP22o, 1PtlbFfovscMiQpaT0Y5VixSR7jn1idZ0, 1HRVv3ak3KsjvUPZu3qgzX6b8z6824bja
- c023 not started: 1ok8xf3b5cNEYyBvAGqRckU8OCPEfZjpa
- c025 not started: 164gcHTyywxFNqkaZby5sfyQK3imL355J, 1SZ8A_FGcKBNpbIx9IyWqbrbwx4MDu0tY, 12EQ3vVau_jfqka46GSSo22m4gfjx2RHy, 1RMjblUaV7i8vB5hhvgGuDuIkoHDAeXfd, 1VodZwgDbf-4TKjllO2iH1ch286FATW1D, 1av71mQa_wUj9DAHoIQOuYA4SOwZgZrzB, 1NtqJ5iBxo4SpSPmV_C9qWSVGuKyHJxtc, 1QwBxa0owAArMfP3AJr3VViWAwveAdzvs, 1x7ROSm6t4eEXUH5_DiSp2uMToy46-qFG
- c026 not started: 1U5YI36gNm20u0EusA45rzffvKTyc8nZ2
- c031 not started: 1G6ie6VHvmK7skTHXeq6CpLs1-aDCSvIb, 1e9AfH9nTprBy-n5n0j3NGfWdNGYSrW92, 1q3oQtVLtzewkPQ3rgywVjX2jlPBNimM_, 15J5eRnDKzbMxkOZq3Qfbe8xE2zzaQ6QX, 14hf4-0yNCg6czcQENWjwIQoDfNLt78iW
- c032 not started: 1hqLtX2Jq8AbxPAbvEaWJT87rZWgaZt-U, 1ZFNvSnjIgydi8fvkJL3Y0I8X-jLGMXFq, 1UGidCwE7CHgGGACN33spRW93OmTQwP5Y, 1vFULjpLvUNraRpkWcsjXYqG27CBYQW4B
- c033 not started: 1mc-LvdBzVlSI1n1F5EhCQZxs0u5l97PE, 1Kmy52Un-JwoCyBNO68mZVf6MzSALAK1z, 1tGyz6QlA5EELcxtbkdFhA-Mbwl7_eoEs, 1Y8iQxUyPfJTuVrVj8Mkuyr4Eg5humUGf, 1rM5C53_K-Brt1-hurZhRy25_yFbrvdzi, 1-SlltbRRXGIG_nKDl0Fi9aaOEF8k0izL, 1jHwpvqk_OjqJHoWIcpkS20pUk9f0KoaS, 1NO8IpeKeoATuaSEJltQ-OFGvrTz4latG, 1Q6M0f2842v3Wt8COQnuUXwbpkdRbI4Yp, 1FVFYo5QOJ9Ab7dYK8jq8yz17k7DZQ9FQ, 1IRIa3oZ9Iq_9Wq4Nrmpn-K6pR3f48rbH, 1wTSVppPHKM8lbxi2imuBE4VwhzQK8mNf, 1xIbCVACqTdS5gEjbvfrgmlmMdHqiKylA, 1UhMmEgNDd574-_IY5jUK85wOlu1uBf-j, 1w15PJjsV8OXjf-Pex0_AoWAkR0Vyr82Y, 10ewHWK25C97wzcYQpxbDJPzVykxRvmGN, 1QhvJDHf-5z2g2L4N12aS621_BNjN1LjB, 1P-8IZmGFjhYMeDj5DyfH3MVYvKcU-1io, 1iY2D_VUaLH4aSooWvYmVVChblhwikGRz, 13WaiNOwximi60wHOJIg7xlVJaxKF1VhI, 18zoNkSFiHvB5vgAfrDO2WAYJdsK8l82v, 1XpZjBJR7Njc6FrdvZt199Xdy94o_3TWM
- c035 not started: 1WFv9HzBRs0kiah80g6odL1ZC9qKT-T_d, 19cGcxo7BQN31FR8e43ValKlLc2Edc8G-, 1kXDjUcYDk6YFPSc5XVKBfOphOFGxDOJR, 15PAkJa_9SgEaIYnq24MgJ32hMVuZbXcG, 1gt4-aEV6pZ4ZXaCOClXmpP8L5G0fOQ8m, 1aW4Xp3llwF-x3IgLSbgxTm8MySi-sBYZ
- c036 not started: 1HbukuvBWbR-jF4sTwS7OKHuV6azaf2NL, 1v0ta4trfZXxYXbFswZYT3mM6bmMzTAG6, 1k4ilvbRc76oGkQkU6K5PEtG6GQJd-Q9j, 1VM6d5P-xp_76KWE2my71wCorGK9PMo-M, 1TdfjDs_eGPDo4lFEVE_unsNvymTkFiZr, 1V8n_V5pCkHpW5HDhRIUsG6OcHp8goG6X, 1aN3bRdt7T2_59Gp268vU_umyOAhJVuFY, 1yBWEZKWIY8Wb1Z12530_lUQF26RtLKTW, 1lAfdc9TwMrFqBE5kHNkNjQTV4aTtI8MP, 11mjbVrBakHqJ93xpOEEG8xlTpxWfnJBN, 1z4TirzxYseaZlUHX0YnFUdnf5_KhFRv9, 1H0oz5-_igqHRYCCWc3LOIHQvJGfkp31h, 1ZmXixqfQnlptjrfUUORtyzAUk8d1pKj7, 1EEAKk7Kw9zOtQPsR8NBC_xkq4eCw90kp, 12-MI7_sM1t4eEgnF2TZX7II_rTfjZzUF, 1aloDJa_TEllx3902vdKlUW1AXiX7nwuL
- c037 not started: 1SsjJ4t2ITYE3vAgZN_-hCR1_VvburBS9, 1RW-T6gsg7YlU55STf6TZZxiQ4UCKcf5_
- c039 not started: 11fiopl24cNJDCOt24ZEURaWmLo2P5l01, 1GLbAujkhxObfAc7fsAfhw_16S7wdlrhb, 1BvBO2ymUW2c5DL9K4wydTMZ3vbbifr06
- c042 not started: 1KyUdiMpnISKX1WKbMucOwvyyitBQlKs_, 19unDiUDy-CEiq60ad6Eb1TH0I87FkPia, 106vUsOgp4ggibGTHZqyl-mrK68HVtuo1, 1pCJAuSMjV5jtOpJI4MFf0_iz4yORtaFg, 1bHDFnkjgXBXtQc8TtU582VKReTp99kD9, 1TvvTQ0mqVYvLmMnp2pJQ6nV90KSRuDv0, 1yPpeicD7k8d70YVaoefkO22LWRnVeHrQ, 1OUhAgTrJqieZCU6L9R4znMiVCQ9c53FL, 1PA6i7tx_BKiHlKJv4-Rz5NUQn3ShXt5g, 1RWvto_s3I5SBk8VAqt-micO7CedWoXmI, 1QFA5YF5xpx4hWNup_mNPmTc9jOpUnHMH, 1dg1AGwYnIk0hqoAmhB3aLIErW1AMIKbO, 1juKcNLT6UV9eYXhHr6IUXYYZcYPzGAtM, 1JRjZgVejubzG0buFj1g5dDb6w7c4z0Xt
- c043 not started: 1r4JUyZU5-_zJR-Idrqapd0f2tED50rxU, 1842Is4vxreIb7IqTlT12HN87e9pR9jUP, 1uDhKT1t8T2BVLTWO6Ck4XHkqgrrDFRAk, 1fAH_KKKw7kNsD2Y64LTYqcW-GJtOsGHT, 1iCdtJuAGkEkTXXxFXersgOTGjkMSCuJB, 1Wat-lTpaUy0ly4_ISiNgNf4gyMIJzZ1I, 1HFba5-rXW7A1Lvt4NLvW8GvBmcvnuxEm, 17GlrtjImTXQ7-GKvMuqdv0bie31tAiMv, 1Uzgl16vqglI4czVZEPEHBL9Qe0oKduVX, 1RoUtYUl55UzWl1BgE3jVepIvwRT7YyZ3, 1U4FPwrQU25A3fiSYabHshvT-tQrrHp7R, 1bRpNnrTJpOrH8WJj_yTwk_njDenSJ7Nu, 1l5CuFI9C0h8QQcPl9qUNMMiwBRYDI__6, 1nlvh2ehUGmCqWSB2vxBfKM4ic591WEEG, 1moe8qc5rHexzqIsv9duS9rWEOKeQ7eIt, 1rZVKgW4OT1HYkyPCvIAr1URFWz1mG02M, 1B2PeYO1A_wJo_YczeFHWp52gJH5sGO6u, 17UNHrJg_RY-PC2SC6HawmKSMFlbS04il
- c044 not started: 1eZOS74HAqtn3mXcZq8M2cmgwcvxtP4UD, 15_ExjYjmzPgnctZ0ByPuGJs8rr_-M3tC, 1FNPbtyi5_S0jMGpu38F2TzjTqgboOSbg, 1ZGCY6i_zy-nI9g6Gjp3pwurXt_5ry7bK, 1fnlsAAYbBpvEilIBsqjd7Np6FtwiWXI7, 1YiyPph0cHBiSJ-Wk7VPZzejwftTZNpc2
- c047 not started: 1S5C1n4r_2w1J9x-u7FAJPYzs6JBHv6y8, 1FtaysUUfboGp62-uIRa5Cq6iLAYfiHET, 1X_OcWdPXzwyJCNyIM04VjhKMd8zaKWDm
- c049 not started: 1x1j43XSQ7XxYQwrfR7yR49DmPly2T5Es, 116LtMCcQ0_jpwOlZcHVdvPoxWGDLMQws, 1Cj-U9nJTNMC4KQv6GVzOo5eTswRENAIr, 1GiIzJTH_dZM9UUru-8uS65AWy_u7ru3y, 15bUsB5_5LQC6RJZJSZpy2WiaK3H1WgYM, 1Q0oeabPuLXdMbMmSjaeTcXc3C3MelPMl, 1rYpg3hsvRcf5Wd2C3-TnConyT-ZJdXZG, 1xlsPWrMVg9Xc8-t59wiJRQQHBgetbrWc, 1tax6ttHzi0VEboULmHumPN8umJmuGRd8, 1WTWTFI3zflJyiiL7mejmnt-Rye4zSRrf
- c054 not started: 1gLFoSJNbeRXCtVnpMTFYRDt7pG37GF_S, 1tsuIQKeRjMzDfJtoDNSN4N1yfEf43Wjt, 1QxJ8kOOP1WNbEUKl0rMZOLnhJjkDrLB5, 1_fBpQ_d3rbbi1j2qjMLvroOod4CoAoD5, 14N-ufMKrzZuNESlpMP9A6wetf1JKWeqT, 1ppd7DvBK5QzysHMPU8KHhwGQgLv3vl8o, 1BrVviC9kHLaSuw-x_inX8GDUqohC3on7, 1RsbpmHtPoHSCWDAZ1lRbeGCRXjvlovah, 1fyjQZFCANLG113c1ECIs8gtUKFx-y0AM, 1yIdijZOz6C85se0BcqUq_WuQNh6K61Kp
- c058 not started: 16QPcWkN05XHNe9e7KrMnmEaJ4BAuhk0K, 1MN985R6fDH6V_LtLVyRv2QmLy4-LgdnC, 13gbdD53GpYWnAxYm-i0-aB3-3EmqsKQ7, 1Kl0nnWJDgYF7AGUnxDZfN1ofSI5k_95K, 1Gr2URzzfF5xnz-dZ4ZkrpbEc3DVLJBqs, 1ygm7682i8bMk-aaa5_cAXti8ntT5re5F, 145ewx4vofyerFERMpIuBeSfavsLFvhUx
- c068 not started: 1PXxGq8P9EWRasLAW9yS7vsD413HArxoC, 1-3h-LLI8qgrtIZN11s2kOj2VetigR6X2, 19tEjDAqtpmO3OUuprkkTce6Ccp6IdRWP
- c069 not started: 1YyuacPWFax4szkWbuB4Ol7tSKlN8DcmE, 1Yc3yklxtGUuVpiykIJERSr1XeRlVqRCP, 1Wpjz6tcTOjGt4xjnMIV86ud_dQIp5kNG, 1xXst7Vj43HxXf_JQaFIeIdK8WrAq_DDk, 1xIPWbQgvtWCOkQz7rNXLsFtngtIUDhXu, 1RcpNCDWtXP3kbzJnKZMFIGx2I7K2al_4, 17syyLxhcDeeAIqp_j0un-jMYyHQPwfeh, 1jzzDKChLZB2GVCbMn3x1lDoIegyuOu_w, 1WZA_8sbjz3lC4drjwmqmKF3pOelDSg7Z, 1jNdR6dzc_Ak8GfxRig1IKvkhLcU5eawx, 1nRQzMpnlPir1C_dF70lOdmUl47eC9lRD, 1zYkyyLWWCVudUJrhbNrx534Rvs84TRK9, 111wdYmSZhnA6TQ0r7RmYJDesguPpEoNZ, 1pg-NOqeIiS4Tp9iBVFPj4osgz-4x9pmv, 1eJSwtKA6hkyXxpc0bvUFit5wyydmAZGC, 11Um2lsnGXngXXhOtoEu2UrFoFvTPumnz, 1ESyv0PwfD-rbGsXZs3qEqP5Ii3xzkNXQ, 1S8DtpDbs7QoxhDqKLEOguvfFtM3wMpGY, 1mJBZe_k4v-RbZ3j2E4nltP764tqrkjuB, 1LLoUuVpSXUEWmSBCIROaAdCitETpeYaq, 1mV879eX-5yH7mOuaS1ju3_t40tOQGMZC, 1MUDSo5QVn5fjpzFuTCJIH1ATrvCGWFLt, 1gsqtIpbG50QFVuiJ8TotOilRDR74lckG, 1LGeRiu7KxvZi6A7vkRA9mpPQVHNaz1U4, 1b5eG6Q8QU_vaF4lGOgplFcFTbGMMIhHb, 1x_u3hUn2UF8w9B_JO9agPUlmsVXE8KMW
- c070 not started: 1WiQ_BBm4CoGfEhj9R7XDZoUUboSFV3xH, 1ozK_-yqAvUwlLWevcuaiBfM075E5VmV6, 1eSQV759pM2kIMgUWlldX21rWgHaJqsKd, 1sdgQW3cA9ysFs1xvvnEPIUvcG6bN6mzQ, 1NfQtsOmhvgTD0sOriswLadWhdhbWORoA, 1Jl1zyjb_Dbzr5GLbm_2XHZCMTW4Oke2R, 1r6bYvzr_00BM62qw1M6DhkYbWBC_32Zy, 1q6_C6hlsDX3TWamrb8FEwtTRMeJf9l4U
- c073 not started: 1HaAuOOOwPnEhBjg98OzA99gbo5kcLgNR, 1iW7CJWaSzuxHQjiIcAt_QSKwvgCh6tOJ, 14AQCS0BorBootGm_iQLYupANX_-_t58d, 18xlA9qCVX0UhA8O5jz3C1KMr2A8XBi1U, 1Jl54L4pBlezINLptlxYwLv3fnWfYOsnN, 1pE5MNDi-Bblh93zNO_xbyd2RZTcVvTfH, 193sG3vgMcCrYC_ubg6RGmaGDBDgiHQlJ
- c074 not started: 1AHImTFr9Z4-yNr-rnBVT-k2qxA41UEOe, 1oUldeR-KM8SAd7Kj22GEMZ_Jjyrvhfk4, 1sZbGriVONvZ2fZSDm0lualioO6GXsfrL, 1Z5TG9YOvhxWpZBN1eNUvkRHiRDjRipgP, 1N62Hfsq1pkpouDQ7ituNBHNNgPSlWyyB, 1xsvMraIPU5cAxDkng2cgsju7cW701hKn, 1Nji4ZHfPhfxil79OTuO_KJzvz558oi_h, 1JNsl0aAcrGa2b57qC9j5gP5cIc8bOlyf, 1fMcDAfooorntJZXfwWDSPQYIxmohsTae, 1Iw4apg1CD45_KpgCIfsMtjXgFYktjWLH
- c075 not started: 1h-daTSXHCRsWa9T-f2M00_jsnaCjR3J1, 1ykjqbAb-d08Lr5Dt9BC4MTdNPnkaK9CN, 1y2skB2CHF9YGBjwduNOLsxjNG9nA712v, 1eFETPe55D9RqQeTr7G76wKcblmz7FK7n
- c076 not started: 1cxZ97rYY0hHZxLNzn784q3iT7Vy9Lbxa, 15IGEZSa5OmEgrwxEJsa6tE_5Mm3ppsts
- c077 not started: 1j1H96ojcF50xkQjnmlselaxTzGdrC_xQ, 1J5if-VT0wfWmorJC_RIy6pI7uaoxAhTf
- c078 not started: 1cIZHoFyXcEpi4DDlw45NLk-OOWG0sSyI, 1LTOS2ymMI1fCaT5By48xvGjwDdf5ucpJ, 1Eligmgy0-HOpQ4i6YsX9g5CqBjjYm5IP, 1wHI4nfvPCGcxzWMzeYr15JSyjey3fVE_
- c080 not started: 1-_BI-hRUEdHRfLIKdbjLiEfxxXiW2bV8, 1Xjc6owRuVIq0T-q6OpEt6heoUp80ZxB1

## (c) NOT STARTED (18), smallest first

Runs = ceil(queued/45).

| course | teacher | title | queued | runs at 45 |
|---|---|---|---|---|
| c079 | អ្នកគ្រូសិរីសុធម្មៈ ជោតិកា ម៉ម សុខហេង | 9-បុណ្យពិសាខបូជា | 7 | 1 |
| c022 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | វេស្សន្តរជាតក | 8 | 1 |
| c040 | លោកម្ចាស់គ្រូ សាសនមុនី ហ៊ឹម ប៊ុនធឿន | 2-ថ្នាក់សមថកម្មដ្ឋាន(២០២៥) | 10 | 1 |
| c034 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | ព្រះត្រៃបិដកបាលីភាគ១៨ | 11 | 1 |
| c038 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | 8-បិដកលេខ២៣ | 11 | 1 |
| c071 | លោកម្ចាស់គ្រូ សុភប្បញ្ញោ ស រដ្ឋា | 4-Buddhism in English Level 3 b | 12 | 1 |
| c024 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | មហោសថជាតក | 15 | 1 |
| c010 | លោកម្ចាស់គ្រូ អគ្គចិត្តោ យ៉ុន យី | 5-បរិច្ឆេទ ទី៥​ កាត់ស្អាត(២០២៦) | 16 | 1 |
| c045 | លោកម្ចាស់គ្រូ ពុទ្ធង្កុរ ភុល ណារិន | 2-បរិច្ឆេទទី ៨  | 17 | 1 |
| c086 | លោកម្ចាស់គ្រូ ឡេង ស៊ីដែន | 6-បទរូបសិទ្ធិ | 19 | 1 |
| c041 | លោកម្ចាស់គ្រូ សាសនមុនី ហ៊ឹម ប៊ុនធឿន | 3-វគ្គអន្តរជាតិ(វគ្គខ្លី) | 21 | 1 |
| c084 | លោកម្ចាស់គ្រូ ឡេង ស៊ីដែន | 4- វិធីរើសអង្គធម៌ | 25 | 1 |
| c085 | លោកម្ចាស់គ្រូ ឡេង ស៊ីដែន | 5-សិក្សាគាថាធម្មបទ | 26 | 1 |
| c081 | លោកម្ចាស់គ្រូ ឡេង ស៊ីដែន | 1-ប្រែការកពិសេស | 29 | 1 |
| c067 | លោកម្ចាស់គ្រូ កិត្តិប្បញ្ញោ ថូ ចន្ថា | 3-អង្គុត្តរនិកាយ  | 31 | 1 |
| c066 | លោកម្ចាស់គ្រូ កិត្តិប្បញ្ញោ ថូ ចន្ថា | សៀវភៅ pdf | 33 | 1 |
| c082 | លោកម្ចាស់គ្រូ ឡេង ស៊ីដែន | 2- ប្រែគម្ពីរអង្គុត្តរនិកាយ ឯកក | 43 | 1 |
| c046 | លោកម្ចាស់គ្រូ ពុទ្ធង្កុរ ភុល ណារិន | 3-អង្គុត្តរនិកាយ «និរុត្តិ+សង្គ | 175 | 4 |

## EMPTY (20), 0 data rows

c002, c003, c004, c005, c027, c028, c029, c030, c050, c051, c052, c053, c055, c056, c059, c060, c061, c062, c063, c064
