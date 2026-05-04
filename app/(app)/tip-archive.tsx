import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "../../hooks/useColors";
import { TIPS, Tip } from "../../lib/dailyTips";
import { useTips } from "../../context/TipsContext";
import { SEARCH_QUERY_MAX_LENGTH } from "../../lib/inputLimits";

export default function TipArchiveScreen() {
  const colors = useColors();
  const { favorites, toggleFavorite } = useTips();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Tip["category"] | "all">("all");

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
        },
        searchContainer: {
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: colors.muted,
          margin: 16,
          borderRadius: 12,
          paddingHorizontal: 12,
        },
        searchIcon: {
          marginRight: 8,
        },
        searchInput: {
          flex: 1,
          height: 48,
          color: colors.foreground,
          fontFamily: "Inter_400Regular",
        },
        filterContainer: {
          marginBottom: 8,
        },
        filterContent: {
          paddingHorizontal: 16,
          gap: 8,
        },
        filterBadge: {
          paddingHorizontal: 16,
          paddingVertical: 8,
          borderRadius: 20,
          backgroundColor: colors.muted,
          borderWidth: 1,
          borderColor: colors.border,
        },
        filterBadgeActive: {
          backgroundColor: colors.primary,
          borderColor: colors.primary,
        },
        filterText: {
          color: colors.mutedForeground,
          fontSize: 14,
          fontFamily: "Inter_500Medium",
        },
        filterTextActive: {
          color: colors.background,
          fontWeight: "600",
        },
        listContent: {
          padding: 16,
          gap: 16,
        },
        tipCard: {
          backgroundColor: colors.card,
          borderRadius: 16,
          padding: 16,
          borderWidth: 1,
          borderColor: colors.border,
        },
        tipHeader: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        },
        categoryBadge: {
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 6,
        },
        categoryText: {
          color: colors.background,
          fontSize: 10,
          fontWeight: "700",
        },
        tipText: {
          color: colors.foreground,
          fontSize: 16,
          lineHeight: 24,
          fontFamily: "Inter_400Regular",
        },
        emptyContainer: {
          padding: 32,
          alignItems: "center",
        },
        emptyText: {
          color: colors.mutedForeground,
          textAlign: "center",
          fontFamily: "Inter_400Regular",
        },
      }),
    [colors],
  );

  const filteredTips = useMemo(() => {
    return TIPS.filter((tip) => {
      const matchesSearch = tip.text.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = category === "all" || tip.category === category;
      return matchesSearch && matchesCategory;
    });
  }, [search, category]);

  const renderItem = ({ item }: { item: Tip }) => {
    const isFavorite = favorites.includes(item.id);

    return (
      <View style={styles.tipCard}>
        <View style={styles.tipHeader}>
          <View style={[styles.categoryBadge, { backgroundColor: getCategoryColor(item.category) }]}>
            <Text style={styles.categoryText}>{item.category.toUpperCase()}</Text>
          </View>
          <TouchableOpacity onPress={() => toggleFavorite(item.id)}>
            <Ionicons
              name={isFavorite ? "heart" : "heart-outline"}
              size={24}
              color={isFavorite ? colors.destructive : colors.mutedForeground}
            />
          </TouchableOpacity>
        </View>
        <Text style={styles.tipText}>{item.text}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color={colors.mutedForeground} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search tips..."
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
          maxLength={SEARCH_QUERY_MAX_LENGTH}
        />
      </View>

      <View style={styles.filterContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterContent}>
          {(["all", "memory", "wellness", "productivity", "motivation"] as const).map((cat) => (
            <TouchableOpacity
              key={cat}
              onPress={() => setCategory(cat)}
              style={[
                styles.filterBadge,
                category === cat && styles.filterBadgeActive,
              ]}
            >
              <Text
                style={[
                  styles.filterText,
                  category === cat && styles.filterTextActive,
                ]}
              >
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={filteredTips}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No tips found matching your criteria.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

function getCategoryColor(category: Tip["category"]) {
  switch (category) {
    case "memory": return "#a78bfa";
    case "wellness": return "#5eead4";
    case "productivity": return "#fbbf24";
    case "motivation": return "#f87171";
    default: return "#9ca0c2";
  }
}
