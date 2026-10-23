import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'api_client.dart';

class OfflineQueue {
  static const key = 'offline_punch_queue';

  Future<void> enqueue(Map<String, dynamic> payload) async {
    final preferences = await SharedPreferences.getInstance();
    final items = preferences.getStringList(key) ?? <String>[];
    items.add(jsonEncode(payload));
    await preferences.setStringList(key, items);
  }

  Future<int> pendingCount() async {
    final preferences = await SharedPreferences.getInstance();
    return (preferences.getStringList(key) ?? <String>[]).length;
  }

  Future<void> sync(ApiClient api) async {
    if (!await api.isOnline()) return;
    final preferences = await SharedPreferences.getInstance();
    final items = preferences.getStringList(key) ?? <String>[];
    final remaining = <String>[];
    for (final item in items) {
      try {
        await api.punch(jsonDecode(item) as Map<String, dynamic>);
      } catch (_) {
        remaining.add(item);
      }
    }
    await preferences.setStringList(key, remaining);
  }
}

