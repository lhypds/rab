# 京都市租赁业务爬虫

从京都府观光联盟目录、目录对应的运营方页面、梨花和服分店目录、ニコニコレンタカー京都市目录、京都市观光协会、町家レジデンスイン京都、京都市都市整备公社、京都ライフ和コーナン采集。一个门店在不同分类提供两项可单独询价的业务时，各有一条记录。采集范围限于这些来源公开的信息。

## 执行计划与覆盖范围

1. 对照项目的 `src/utils/kinds.js` 筛选能从来源确认业务类型的分类。
2. 搜索京都市及其 11 个区，遍历目录分页和租车品牌的京都市分店。核对租赁业务、电话和官网。摄影服务按方案页限定的门店导入。
3. 从设施地址和同页地图或门店结构化数据读取经纬度。缺点位时查询日本国土地理院地址服务，只接受唯一的完整地址匹配，再用国土地理院逆地理编码核对行政区。
4. 从设施、门店或具体服务的图库取 2–3 张不同图片。转为最长边 1280 像素的 WebP，另存最长边 320 像素的缩略图。图片或联系方式不足的结果记录到运行报告。
5. 写入公共账号的原生 item 目录，使用咨询预约模式。售价留空，用户通过官网或电话询价。验证地图接口及实际图片响应。

| 大类 | 本次采集 | 本次略过 |
| --- | --- | --- |
| Things | car、bike、clothing、tools | camera、video-camera、projector、3d-printer、audio、electronics、camping、sports、other |
| Spaces | meeting-room、parking、event-space、home、studio、storage、workspace | other |
| Services | photography、driver、teaching、guide | repair、moving、cleaning、design、translation、music、fitness、beauty、massage、pet-care、childcare、care、cooking、delivery、gardening、it-support、programming、videography、writing、consulting、event-help、handyman、other |

略过的分类需要新的来源或业务识别规则。会议室限已核实对外使用的场馆，旅游景点周边推荐、通用宣传图和已知停业项目不计入。

## 运行

在项目根目录运行，需要 Python 3.10+ 和 macOS 或 Linux。

```sh
python3 -m pip install -r data/crawlers/kyoto_rentals/requirements.txt
python3 data/crawlers/kyoto_rentals/crawl.py
python3 data/crawlers/kyoto_rentals/operators.py
python3 data/crawlers/kyoto_rentals/verify.py --wards
```

默认输出到 `data/users/_public/items/<id>/`。可以通过 `--output` 指定另一套 items 目录。每条记录包含 `item.json`、图片、缩略图以及记录详情页和图片原始 URL 的 `source.json`。按来源和分类去重，重复运行会补充新业务并保留已有编辑。临时目录与输出在同一文件系统，单条记录完整后才移动到最终目录。`last-run.json` 列出最近一次运行的结果和跳过原因。

服务启动时载入 items 和图片索引。让运行中的服务重新加载后，可对实际地图和图片接口验证：

```sh
python3 data/crawlers/kyoto_rentals/verify.py --api http://localhost:3016 --wards
```

扩展采集可以通过 `--source home|parking|city|storage|tools` 单独运行。町家按整栋出租地址收录，使用运营方的公共预约电话。くるっとパーク优先使用设施电话，缺号时仅对该品牌使用运营方总务停车场部的公开电话，并在详情中注明。京都ライフ采用设施页面的咨询电话。コーナン仅收录分店页面明确提供租赁工具的门店，图片来自运营方的出租工具目录。扩展采集的结果保存在同目录的 `operators-*-report.json`。
